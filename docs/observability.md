# NexusPay Observability - Metrics, SLOs, Alerting

Two deployment paths share one signal design. On the Oracle k3s box the
**kube-prometheus-stack** runs live in the `monitoring` namespace (see
`docs/k3s-gitops-deployment.md` §6); Prometheus scrapes all seven service pods (17/17 targets up),
Grafana serves 30 dashboards, and Alertmanager delivers to Mailpit. The Docker
Compose stack below stays as the local/dev reference with the same rules,
Alertmanager config and SLOs.

## Components

| Tool | Port | Role |
|------|------|------|
| Prometheus | `9090` | Scrapes `/metrics` from all 7 services, evaluates rules |
| Grafana | `3000` | Provisioned dashboard + datasources (Prometheus, Loki, Jaeger) |
| Jaeger | `16686` | OpenTelemetry trace storage + query UI |
| Loki | `3100` | Log aggregation (with Promtail shipping service logs) |
| Alertmanager | `9093` | Receives firing alerts, groups/dedupes, routes to receivers |

Signals per service (`services/*/src/lib/metrics.ts` + `telemetry.ts`):

- **RED metrics** - `http_requests_total` (counter, `method`/`route`/`status_class`
  labels) and `http_request_duration_seconds` (histogram). Payments also exposes
  `payments_queue_depth` (BullMQ gauge per state); feature flags exposes
  `feature_flag_evaluations_total{result}` and `feature_flag_changes_total{action}`; fraud
  exposes `fraud_checks_total{decision}` and `fraud_rule_hits_total{rule}`;
  reporting exposes `report_refresh_total{status}` and `report_rows_written_total`.
- **Traces** - OTel SDK (`@opentelemetry/sdk-node`) exports to Jaeger via OTLP; log
  correlation via trace IDs.

## SLOs and SLIs (`infra/monitoring/prometheus/rules/recording_rules.yml`)

| SLO | SLI (target) | Recorded as |
|-----|--------------|-------------|
| Availability | error ratio <0.5% (99.5%) | `nexuspay:http_error_ratio:rate5m` / `:rate1h` |
| Latency | p99 < 2s | `nexuspay:http_request_duration_seconds:p99:rate5m` / `:rate1h` |
| Error budget (30d) | burn rate, 5m + 1h windows | `nexuspay:slo:burn_rate:5m` / `:1h` |

Burn rate = observed error ratio / allowed error ratio (0.005). A burn rate of
**1x** spends the 30-day budget exactly on schedule; higher rates predict how soon
the budget is exhausted.

## Alerting rules (`infra/monitoring/prometheus/rules/alerting_rules.yml`)

| Alert | Condition | Severity |
|-------|-----------|----------|
| `NexusPayHighErrorRate` | error ratio >1% for 2m | warning |
| `NexusPayHighP99Latency` | p99 >2s for 5m | warning |
| `NexusPayPaymentsQueueBacklog` | queue depth >100 for 2m | page |
| `NexusPaySloCriticalBurn` | burn rate >14.4x on 1h (budget gone in <2 days) | page |
| `NexusPaySloWarningBurn` | burn rate >6x on 5m (budget gone in <5 days) | warning |
| `NexusPayTargetDown` | service unreachable for 1m | page |
| `NexusPayReportingSnapshotStale` | no successful snapshot for 26h (k3s only) | warning |
| `NexusPayReportingSnapshotFailed` | a snapshot job failed for 5m (k3s only) | warning |
| `NexusPayNodeDiskFilling` | root filesystem >85% used for 15m (k3s only) | warning |
| `NexusPayNodeMemoryLow` | >90% node memory used for 10m (k3s only) | warning |
| `NexusPayPodRestarting` | >2 container restarts in 30m (k3s only) | warning |
| `NexusPayReplicasUnavailable` | available replicas below desired for 10m (k3s only) | warning |
| `NexusPayPvcPending` | a PVC stays Pending for 15m (k3s only) | warning |

## Alert routing (`infra/monitoring/alertmanager/alertmanager.yml`)

Alerts are grouped by `alertname` + `service`, deduped/repeated under
`group_wait`/`repeat_interval`, and emailed to `ops@nexuspay.local` through
**Mailpit** (`mailpit:1025` SMTP). Every firing and resolved alert is visible at
`http://localhost:8025` - no external account required, so the full
Prometheus -> Alertmanager -> notification path is verifiable locally.

## Kubernetes (live on k3s)

`infra/kubernetes/alerts/nexuspay-alerts.yaml` is the same rule set as a
`monitoring.coreos.com/v1` `PrometheusRule`, reconciled by the
`nexuspay-platform-alerts` ArgoCD app. The stack itself is a Helm add-on:

```bash
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack   -n monitoring --version 92.16.1   -f infra/kubernetes/monitoring/kube-prometheus-stack-values.yaml
```

Verified 2026-11-01: 17/17 prod pods `up=1` via seven ServiceMonitors, 5 SLO
recording rules + 13 alerting rules loaded (two snapshot checks added 2026-11-10 and
five bare-metal host/workload signals added 2026-11-10), NexusPay RED dashboard delivered
as a GitOps ConfigMap with nine panels including reporting activity and host capacity, and
an injected test alert delivered to Mailpit. Prometheus,
Grafana and Alertmanager are ClusterIP-only; port-forward to reach them.

### Bare-metal signals

On a single node there is no cloud autoscaler, managed disk or second host to absorb a
failure, so the five `NexusPay*` host/workload alerts above watch the things that actually
take this cluster down. They use metrics already scraped by `node-exporter` and
`kube-state-metrics`; no new exporter, controller or workload was added.

| Signal | Expression (short) | Why it matters here |
|---|---|---|
| Root disk | `1 - avail/size{mountpoint="/"} > 0.85` | Images, container logs and the Prometheus TSDB share one 83 GB filesystem |
| Node memory | `1 - MemAvailable/MemTotal > 0.90` | No second node to reschedule onto; OOM kills hit every pod at once |
| Container restarts | `increase(kube_pod_container_status_restarts_total[30m]) > 2` | Catches CrashLoopBackOff before the deployment loses a replica |
| Replica shortfall | `replicas_available < replicas_desired` | Surfaces unschedulable or failing pods that a `Running` count hides |
| Pending PVC | `kube_persistentvolumeclaim_status_phase{phase="Pending"} == 1` | `local-path` is the only provisioner; an unbound claim blocks its pod forever |

Baselines captured on 2026-11-10, all below threshold: root disk 35.3% used, node memory
35.3% used, zero restarts in 30 minutes, every deployment at its desired replica count, and
all 12 PVCs `Bound`. Each rule evaluates `inactive`, with `for` durations (10-15m) chosen to
ignore image pulls and rolling restarts.

Deliberately not covered yet: certificate expiry and node readiness. cert-manager exposes
`certmanager_certificate_expiration_timestamp_seconds`, but the Prometheus instance does not
scrape the `cert-manager` namespace yet, so there is no series to alert on. Adding a
ServiceMonitor (and a probe for the public endpoint) is the next step, not a claim in this
document.

## Try it

```bash
docker compose up -d --build   # starts the full stack including observability
curl -s http://localhost:9090/-/healthy
curl -s http://localhost:9090/api/v1/alerts
```

To trigger a page locally: `docker compose stop notifications-service`, wait ~90s,
then check `http://localhost:8025` for the `[FIRING] NexusPayTargetDown` email.
`docker compose start notifications-service` fires the `[RESOLVED]` email.

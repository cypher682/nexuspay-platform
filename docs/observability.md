# NexusPay Observability - Metrics, SLOs, Alerting

Two deployment paths share one signal design. On the Oracle k3s box the
**kube-prometheus-stack** runs live in the `monitoring` namespace (see
`docs/k3s-gitops-deployment.md` §6); Prometheus scrapes the four service pods,
Grafana serves 30 dashboards, and Alertmanager delivers to Mailpit. The Docker
Compose stack below stays as the local/dev reference with the same rules,
Alertmanager config and SLOs.

## Components

| Tool | Port | Role |
|------|------|------|
| Prometheus | `9090` | Scrapes `/metrics` from all 5 services, evaluates rules |
| Grafana | `3000` | Provisioned dashboard + datasources (Prometheus, Loki, Jaeger) |
| Jaeger | `16686` | OpenTelemetry trace storage + query UI |
| Loki | `3100` | Log aggregation (with Promtail shipping service logs) |
| Alertmanager | `9093` | Receives firing alerts, groups/dedupes, routes to receivers |

Signals per service (`services/*/src/lib/metrics.ts` + `telemetry.ts`):

- **RED metrics** - `http_requests_total` (counter, `method`/`route`/`status_class`
  labels) and `http_request_duration_seconds` (histogram). Payments also exposes
  `payments_queue_depth` (BullMQ gauge per state); feature flags exposes
  `feature_flag_evaluations_total{result}` and `feature_flag_changes_total{action}`.
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

Verified 2026-10-31: 13/13 prod pods `up=1` via five ServiceMonitors, 5 SLO
recording rules + 6 alerting rules loaded, NexusPay RED dashboard delivered as a
GitOps ConfigMap, and an injected test alert delivered to Mailpit. Prometheus,
Grafana and Alertmanager are ClusterIP-only; port-forward to reach them.

## Try it

```bash
docker compose up -d --build   # starts the full stack including observability
curl -s http://localhost:9090/-/healthy
curl -s http://localhost:9090/api/v1/alerts
```

To trigger a page locally: `docker compose stop notifications-service`, wait ~90s,
then check `http://localhost:8025` for the `[FIRING] NexusPayTargetDown` email.
`docker compose start notifications-service` fires the `[RESOLVED]` email.

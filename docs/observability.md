# NexusPay Observability - Metrics, SLOs, Alerting

The observability stack runs locally in Docker Compose at zero cloud spend and is the
on-call signal path for the whole platform.

## Components

| Tool | Port | Role |
|------|------|------|
| Prometheus | `9090` | Scrapes `/metrics` from all 4 services, evaluates rules |
| Grafana | `3000` | Provisioned dashboard + datasources (Prometheus, Loki, Jaeger) |
| Jaeger | `16686` | OpenTelemetry trace storage + query UI |
| Loki | `3100` | Log aggregation (with Promtail shipping service logs) |
| Alertmanager | `9093` | Receives firing alerts, groups/dedupes, routes to receivers |

Signals per service (`services/*/src/lib/metrics.ts` + `telemetry.ts`):

- **RED metrics** - `http_requests_total` (counter, `method`/`route`/`status_class`
  labels) and `http_request_duration_seconds` (histogram). Payments also exposes
  `payments_queue_depth` (BullMQ gauge per state).
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

## k8s scaffolding

`infra/kubernetes/alerts/nexuspay-alerts.yaml` is the same rule set as a
`monitoring.coreos.com/v1` `PrometheusRule`, ready for a kube-prometheus install in
minikube via ArgoCD.

## Try it

```bash
docker compose up -d --build   # starts the full stack including observability
curl -s http://localhost:9090/-/healthy
curl -s http://localhost:9090/api/v1/alerts
```

To trigger a page locally: `docker compose stop notifications-service`, wait ~90s,
then check `http://localhost:8025` for the `[FIRING] NexusPayTargetDown` email.
`docker compose start notifications-service` fires the `[RESOLVED]` email.

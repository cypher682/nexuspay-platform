# NexusPay Platform

A seven-service payments platform in Node.js/TypeScript, built to exercise the full lifecycle
of a real system: identity, ledger, messaging, fraud, reporting, CI/CD, GitOps, security
policies, and observability. Runs on a laptop with Docker Compose, deploys to a single-node
k3s cluster through ArgoCD.

<p>
  <a href="https://github.com/cypher682/nexuspay-platform/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/cypher682/nexuspay-platform/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178c6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-24-339933?logo=node.js&logoColor=white">
  <img alt="Kubernetes" src="https://img.shields.io/badge/Kubernetes-k3s-326ce5?logo=kubernetes&logoColor=white">
  <img alt="ArgoCD" src="https://img.shields.io/badge/GitOps-ArgoCD-ef6b4a?logo=argo&logoColor=white">
  <img alt="Helm" src="https://img.shields.io/badge/Helm-3-0f1689?logo=helm&logoColor=white">
  <img alt="Prometheus" src="https://img.shields.io/badge/Metrics-Prometheus-e6522c?logo=prometheus&logoColor=white">
</p>

## What it is

- **Seven services** behind one gateway: auth, payments, notifications, feature flags, fraud,
  and reporting, all TypeScript + Express 5 + Prisma.
- **Real money semantics**: idempotent payment creation, a strict state machine, and a
  double-entry ledger that stays balanced through refunds. Amounts are integer minor units.
- **Real operations**: Helm library chart, ArgoCD ApplicationSet, Gatekeeper admission policies,
  NetworkPolicies, Pod Security Admission `restricted`, digest-pinned arm64 images, migrations
  as PreSync Jobs.
- **Real feedback loops**: GitHub Actions CI with per-service matrices, OpenAPI drift
  validation, k6 load tests, Prometheus SLOs, Alertmanager to Mailpit, and Grafana.

The payment provider and email/SMS transports are simulated behind clean interfaces, so the
whole stack runs offline with no credentials. Nothing else is faked: auth, ledger, retries,
webhooks, CI, GitOps, and alerting are the real implementations.

## Live deployment

GitOps-managed on a single-node k3s cluster (Oracle Cloud ARM):

| | |
|---|---|
| URL | <https://nexuspay.141-148-69-94.sslip.io> (`/health/ready`, `/v1/auth/register`, `/docs`) |
| Ingress / TLS | Traefik + cert-manager (Let's Encrypt HTTP-01) |
| Delivery | ArgoCD `ApplicationSet` over `infra/kubernetes/helm/services/*`, auto-sync + self-heal |
| Images | `linux/arm64` builds pushed to GHCR by `publish.yml` after green CI, pinned by digest |
| Data | PostgreSQL 16 (one database per service), Redis 7, RabbitMQ 3.13, Mailpit |
| Migrations | Prisma `migrate deploy` in Helm PreSync hooks |
| Observability | 7 ServiceMonitors, 17/17 targets up, SLO recording rules, burn-rate alerts |

Runbook, verification output, rollback and limitations:
[docs/k3s-gitops-deployment.md](docs/k3s-gitops-deployment.md).

## Services

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 4000 | JWT validation, Redis sliding-window rate limiting, routing, circuit breaker, request IDs, `/docs` |
| `auth-service` | 4001 | Registration, login, refresh rotation with reuse detection, TOTP MFA, RBAC scopes, audit log, lockout |
| `payments-service` | 4002 | Idempotent creation, state machine, double-entry ledger, HMAC webhooks, reconciliation worker |
| `notifications-service` | 4003 | RabbitMQ consumer, templated email/SMS, delivery tracking, dead-letter handling |
| `feature-flags-service` | 4004 | Flag CRUD + audit, deterministic percentage rollout, allowlists, variants, batch evaluation |
| `fraud-service` | 4005 | Synchronous risk gate: amount / velocity / denylist rules, persisted decisions, fail-open on timeout |
| `reporting-service` | 4006 | UTC daily payment snapshots, idempotent range refresh, run history, CSV export, nightly CronJob |

Each business service owns its database and Prisma migrations; every service has health/readiness
probes, structured JSON logs, `/metrics`, Jest tests, and a multi-stage non-root image.

## Architecture

```
                     +---------------------------+
  Clients ---------> | api-gateway          4000 |----> auth-service        4001 --> nexuspay_auth
                     | JWT · rate limit · proxy  |----> payments-service    4002 --> nexuspay_payments
                     | circuit breaker · /docs   |----> notifications-service 4003 --> nexuspay_notifications
                     +-------------+-------------+----> feature-flags-service 4004 --> nexuspay_featureflags
                                   |                  reporting-service    4006 --> nexuspay_reporting
                                   |                                                    (reads payments)
                                   +----> Redis (rate limits, locks, token families)
                                          RabbitMQ (payment.succeeded / payment.failed)
                                          Mailpit (email, alert delivery)

  payments-service ---> fraud-service 4005 --> nexuspay_fraud
```

- Only the gateway is published; internal services are reachable only inside the cluster network.
- Payment outcomes fan out over a RabbitMQ topic exchange; unprocessable messages go to a DLQ.
- Each service owns its schema. Reporting reads payments through a time-bounded, read-only pool.

## Quick start

Requires Docker Desktop with Compose.

```bash
git clone https://github.com/cypher682/nexuspay-platform.git
cd nexuspay-platform
cp .env.example .env
docker compose up -d --build
npm run migrate:all
curl http://localhost:4000/health
```

| What | URL | Credentials |
|---|---|---|
| API + Swagger UI | http://localhost:4000/docs | - |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| RabbitMQ management | http://localhost:15672 | `nexuspay` / `nexuspay` |
| Mailpit (captured mail) | http://localhost:8025 | - |
| Jaeger (Compose only) | http://localhost:16686 | - |

PostgreSQL is published on host port `5433` to avoid colliding with a local install; services
use `postgres:5432` internally. Register a user, open Mailpit, follow the verification link,
then log in and create a payment to watch the event fan out.

## Verified behaviour

Checked against the live cluster on 2026-11-01, not just unit tests:

- All 11 ArgoCD applications `Synced/Healthy`; 17/17 Prometheus targets `up=1`.
- Payments: 50k kobo succeeded, 20M kobo flagged `REVIEW` and still succeeded, denylisted user
  produced `FAILED / fraud_blocked:denylist` with a `BLOCK` decision persisted.
- Reporting: a 7-day refresh wrote 3 daily rows, JSON and CSV export returned them through the
  public gateway, an inverted range returned 422, and a manual CronJob run wrote 3 rows.
- Alerting: a `NexusPayTargetDown` alert fired and resolved; test alerts reached Mailpit.
- k6 load testing found three real defects (bcrypt blocking the event loop, a missing gateway
  proxy route, and over-aggressive rate limits); all fixed and documented in
  [docs/k6-load-testing.md](docs/k6-load-testing.md).

## Delivery pipeline

- **CI** (`.github/workflows/ci.yml`): changed-service matrix, ESLint + `tsc --noEmit`, Jest,
  Docker build, Trivy (fail on CRITICAL), `npm audit`, OpenAPI drift check + Spectral, k6 smoke.
- **Publish** (`.github/workflows/publish.yml`): arm64 builds only after CI succeeds, tagged by
  commit and digest-pinned for GitOps.
- **GitOps**: Helm library chart renders Deployment, Service, PDB, NetworkPolicy, ServiceMonitor,
  migration Job; one thin chart per service; ArgoCD reconciles `main`.
- **Security**: default-deny NetworkPolicies, PSA `restricted`, Gatekeeper (allowed registries,
  digest required, resources required), non-root containers, no secrets in git.

## Repository layout

```
services/                 # 7 services, one directory each
infra/kubernetes/         # helm/ (library + charts), argocd/, policies/, network-policies/, scripts/
infra/monitoring/         # Compose-era Prometheus/Grafana/Loki/Jaeger config
k6/                       # smoke and load scenarios
scripts/                  # OpenAPI drift validation, test-user seed
docs/                     # architecture, deployment, observability, security, service runbooks
.github/workflows/        # ci.yml, publish.yml
docker-compose.yml        # local stack: data layer + 7 services + observability
```

## Documentation

| Doc | Contents |
|---|---|
| [architecture.md](docs/architecture.md) | System design and request/payment flows |
| [k3s-gitops-deployment.md](docs/k3s-gitops-deployment.md) | Cluster build, ArgoCD, verification, rollback |
| [observability.md](docs/observability.md) | Metrics, SLOs, alert routing |
| [security.md](docs/security.md) | Network policies, PSA, Gatekeeper, secret handling |
| [minikube-deployment-guide.md](docs/minikube-deployment-guide.md) | Local Kubernetes walkthrough |
| [feature-flags.md](docs/feature-flags.md) | Flag model and evaluation algorithm |
| [fraud-service.md](docs/fraud-service.md) | Rules engine, scoring, payment gate |
| [reporting-service.md](docs/reporting-service.md) | Snapshot model, report API, CronJob runbook |
| [k6-load-testing.md](docs/k6-load-testing.md) | Scenarios, thresholds, findings |
| [lab-roadmap.md](docs/lab-roadmap.md) | What is shipped, scaffolded, or deferred |

## Security notes

- The gateway is the only HTTP entrypoint; identity headers from clients are stripped and set
  from the verified token.
- Webhooks are HMAC-verified before state is persisted, and failures return non-2xx so providers
  retry.
- All seven images are digest-pinned; Gatekeeper rejects unpinned or unapproved registries.
- Compose credentials are local defaults. Override `POSTGRES_*`, `RABBITMQ_*`, and `GRAFANA_*`
  before exposing anything beyond localhost.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under [MIT](LICENSE).

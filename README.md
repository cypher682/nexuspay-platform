# NexusPay Platform

<p align="center">
  <strong>A production-grade fintech platform, built from scratch as a self-contained DevOps showcase.</strong><br/>
  Four Node.js/TypeScript microservices behind an API gateway - wired for GitOps, container security,<br/>
  observability, load testing, and API contract validation - all running locally at <strong>zero cloud spend</strong>.
</p>

<p align="center">
  <a href="https://github.com/cypher682/nexuspay-platform/actions"><img alt="CI" src="https://github.com/cypher682/nexuspay-platform/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20_LTS-339933?logo=node.js&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169e1?logo=postgresql&logoColor=white">
  <img alt="Redis" src="https://img.shields.io/badge/Redis-7-dc382d?logo=redis&logoColor=white">
  <img alt="RabbitMQ" src="https://img.shields.io/badge/RabbitMQ-3.13-ff6600?logo=rabbitmq&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-Compose-2496ed?logo=docker&logoColor=white">
  <img alt="Kubernetes" src="https://img.shields.io/badge/Kubernetes-Minikube-326ce5?logo=kubernetes&logoColor=white">
  <img alt="ArgoCD" src="https://img.shields.io/badge/GitOps-ArgoCD-ef6b4a?logo=argo&logoColor=white">
  <img alt="Helm" src="https://img.shields.io/badge/Helm-3-0f1689?logo=helm&logoColor=white">
  <img alt="k6" src="https://img.shields.io/badge/Load_Testing-k6-7d64ff?logo=k6&logoColor=white">
  <img alt="Prometheus" src="https://img.shields.io/badge/Metrics-Prometheus-e6522c?logo=prometheus&logoColor=white">
  <img alt="Grafana" src="https://img.shields.io/badge/Dashboards-Grafana-f46800?logo=grafana&logoColor=white">
  <img alt="Jaeger" src="https://img.shields.io/badge/Tracing-Jaeger-66cfe7?logo=jaeger&logoColor=white">
</p>

---

## About

**NexusPay** is a payment platform engineered end-to-end - from auth and payments to
event-driven notifications - wrapped in the environments and pipelines senior engineers
actually operate in. It is a **hands-on portfolio of production patterns**: every layer a
real fintech needs (identity, ledger, messaging, monitoring, delivery) is implemented here,
self-contained, and runs on any laptop.

Built to be _reviewed_, not just _shown_. Each subsystem is real code with real tests, real
retries, real security checks, and real CI - so it reads like a codebase you'd inherit at a
well-run platform team, and demonstrates that you can design and operate the whole thing.

> **Scope is honest:** the payment provider and SMS/email transports are **simulated** behind
> clean seams (a `MOCK_*` provider and Mailpit), so the platform is fully runnable offline with
> no credentials. Everything else - auth, ledger, messaging, delivery state, CI/CD, GitOps,
> observability - is the real thing.

---

## Feature highlights

| Area | What you'll find |
|------|------------------|
| **Identity & IAM** (`auth-service`) | Register/login, refresh-token rotation with **family reuse detection**, TOTP MFA, **RBAC permission scopes** embedded in JWTs, brute-force lockout, audit trail, email + password-reset verification |
| **Payments** (`payments-service`) | **Idempotent** payment creation (Postgres + Redis locks), a strict **state machine**, **double-entry ledger** (balanced through refunds), HMAC-verified **provider webhooks**, scheduled **reconciliation** |
| **Async Notifications** (`notifications-service`) | Event-driven via **RabbitMQ** topic exchange; templated email/SMS with delivery tracking and **dead-letter** handling for poison messages |
| **API Gateway** (`gateway`) | **JWT** validation, Redis sliding-window **rate limiting**, downstream **circuit breaker**, correlated request IDs, forwarded identity (headers scrubbed, set explicitly) |
| **CI/CD** | Changed-service matrix detection, lint + typecheck, Jest unit tests, Docker **build + push to GHCR** with OCI cache, **Trivy** CVE scanning, `npm audit`, **OpenAPI drift validation + Spectral**, and a **k6 smoke test** against the full stack |
| **GitOps** | Helm library chart + one per service, **ArgoCD** `AppProject` + `ApplicationSet`, **Gatekeeper** admission policies, secrets bootstrap |
| **Observability** | OpenTelemetry **distributed tracing** (Jaeger), Prometheus **RED metrics**, Grafana dashboard, Loki logs |
| **Load testing** | k6 suites (smoke / auth / payment) with thresholds that caught real bugs (event-loop blocking, missing proxy route) |

---

## Architecture

```
                        +------------------------+
  Clients -------------> api-gateway     :4000   |
                        | JWT validation        |
                        | rate limiting         +-- Redis (rate limits,
                        | routing, circuit      |   correlation IDs)
                        +-----------+-----------+
                                    |
          +-------------------------+--------------------------+
          v                         v                          v
+-------------------+      +---------------------+      +------------------------+
| auth-service      |      | payments-service    |      | notifications-service  |
| :4001             |      | :4002               |      | :4003                  |
| JWT + rotation    |<+--->| Idempotent lifecycle|----->| Template engine        |
| TOTP MFA          | Auth | Ledger entries      |      | Email/SMS senders      |
| RBAC + audit      |      | Inbound webhooks    |      | RabbitMQ consumer      |
+---------+---------+      +----------+----------+      +-----------+------------+
          |                          |                             |
          v                          v                             v
   nexuspay_auth              nexuspay_payments            nexuspay_notifications
   (PostgreSQL)               (PostgreSQL)                 (PostgreSQL)
```

- **Single entrypoint** - all traffic enters through the gateway (the only port published to
  the host); internal services live on the private Docker network.
- **Event-driven** - payment outcomes (`payment.succeeded` / `payment.failed`) fan out over a
  RabbitMQ **topic exchange**; notifications-service consumes them and enqueues templated
  receipt/status emails, routing unprocessable messages to a **dead-letter queue**.
- **Separate data stores** - each service owns its Postgres database (`nexuspay_auth`,
  `nexuspay_payments`, `nexuspay_notifications`) behind Prisma; cache/shared state in Redis.

> Monetary amounts are stored as **integer minor units** (kobo/cents) - **no floats anywhere**.

---

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| `api-gateway` | 4000 | JWT validation, Redis sliding-window rate limiting, request routing, downstream circuit breaker, correlation IDs, `/v1/me/summary` aggregation |
| `auth-service` | 4001 | Register/login, refresh rotation with family reuse detection, TOTP MFA, RBAC, audit log, brute-force lockout |
| `payments-service` | 4002 | Idempotent payment processing, double-entry ledger, state machine, HMAC-verified provider webhooks, reconciliation |
| `notifications-service` | 4003 | Multi-channel delivery (email/SMS), template engine, RabbitMQ consumer, delivery tracking |

Every service: **TypeScript, Express 5, Prisma ORM, Zod validation, Winston structured logs,
Jest tests, multi-stage Docker builds, health/readiness probes, non-root runtime user,
BuildKit cache mounts, and committed lockfiles** (`npm ci` builds).

---

## Quick start (local)

> Prerequisite: [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Compose.

```bash
git clone https://github.com/cypher682/nexuspay-platform.git
cd nexuspay-platform

cp .env.example .env

# Build & start the full stack (postgres, redis, rabbitmq, 4 services + observability)
docker compose up -d --build

# Apply database migrations for all services
npm run migrate:all

# Gateway is the entrypoint
curl http://localhost:4000/health
```

You're up. Useful URLs:

| What | URL | Login |
|------|-----|-------|
| Gateway health | http://localhost:4000/health | - |
| Interactive API docs (OpenAPI) | http://localhost:4000/docs | - |
| RabbitMQ management | http://localhost:15672 | `nexuspay` / `nexuspay` |
| Mailpit (captured emails) | http://localhost:8025 | - |
| Grafana | http://localhost:3000 | `admin` / `admin` |
| Jaeger (traces) | http://localhost:16686 | - |

> **Ports:** PostgreSQL is published to the host on `localhost:5433` (not `5432`) to avoid
> colliding with a locally-installed Postgres; services talk to it internally on `postgres:5432`.

---

## Try a real flow

Register - you'll get a verification email in **Mailpit** (pointing at the gateway):

```bash
curl -X POST http://localhost:4000/v1/auth/register \
  -H "content-type: application/json" \
  -d '{"email":"you@example.com","password":"Sup3rSecurePass","fullName":"You"}'
```

Open `http://localhost:8025`, click the **verify** link, then log in, create a payment, and
watch the **succeeded** event fan out to a receipt email - all while traces land in Jaeger and
RED metrics show up in Grafana.

---

## What's baked in (DevOps / Infra)

- **CI/CD** - `.github/workflows/ci.yml`: changed-service matrix detection, lint + typecheck,
  unit tests, Docker build + push to GHCR with OCI cache, **Trivy** scanning (fail on CRITICAL),
  `npm audit`, OpenAPI drift validation, **Spectral** lint, and a **k6 smoke test** against the
  full compose stack.
- **GitOps** - Helm library chart + one chart per service (`values-dev`/`values-prod` overlays),
  ArgoCD `AppProject` + `ApplicationSet` (matrix generator over services x environments),
  Gatekeeper admission policies (allowed registries, required resources), secrets bootstrap
  script. See [`infra/kubernetes/`](infra/kubernetes/).
- **Observability** - OpenTelemetry distributed tracing (`@opentelemetry/sdk-node`) across all
  services routed to **Jaeger**; Prometheus **RED** metrics (`/metrics`); provisioned **Grafana**
  dashboard; **Loki** for logs.
- **Load testing** - k6 suites for smoke / auth login / payment flows with tunable thresholds and
  a documented seed for a verified test user. See [`docs/k6-load-testing.md`](docs/k6-load-testing.md).
- **API contract** - OpenAPI 3.1 spec validated against actual source routes in CI
  (`scripts/validate-openapi.ts`) and linted with Spectral. Interactive docs at `/docs/`.

### Load testing caught real bugs

Phase-1 k6 load tests surfaced and fixed **three genuine production issues**, documented in
[`docs/k6-load-testing.md`](docs/k6-load-testing.md):

1. **Synchronous bcryptjs blocked the Node event loop** -> gateway circuit breaker tripped ->
   503 cascade. Fixed with async `bcrypt.compare`, lower rounds in dev, a larger threadpool,
   and a 5s downstream timeout.
2. **Gateway didn't proxy `/users`** -> `/v1/users/me` returned 404 through the API. Route added.
3. **General rate limiter throttled payment load** -> 429s during tests. Rate limits raised for
   load testing (kept tight in production).

---

## Repo structure

```
nexuspay-platform/
|-- services/
|   |-- api-gateway/          # :4000  edge router, authN, rate limits, circuit breaker
|   |-- auth-service/         # :4001  IAM, MFA, RBAC, audit, lockout
|   |-- payments-service/     # :4002  idempotent payments, double-entry ledger, webhooks
|   `-- notifications-service/# :4003  email/SMS via RabbitMQ
|-- infra/
|   |-- kubernetes/           # helm/, argocd/, policies/, data/, scripts/
|   `-- monitoring/           # prometheus/, grafana/, loki/, jaeger (compose)
|-- k6/                       # load-test scripts + local runner
|-- scripts/                  # openapi drift validation, test-user seed
|-- docs/                     # architecture, minikube guide, roadmap, load findings
|-- .github/workflows/ci.yml
`-- docker-compose.yml        # local stack: postgres + redis + rabbitmq + 4 services + obs
```

---

## Documentation

| Doc | What |
|-----|------|
| [`docs/architecture.md`](docs/architecture.md) | Design decisions, flow breakdown |
| [`docs/minikube-deployment-guide.md`](docs/minikube-deployment-guide.md) | Full minikube/GitOps deployment walkthrough |
| [`docs/k6-load-testing.md`](docs/k6-load-testing.md) | Load tests, thresholds, findings |
| [`docs/lab-roadmap.md`](docs/lab-roadmap.md) | 6-phase roadmap (all local, $0) |

---

## Security notes

- The gateway is the **only** HTTP entrypoint; internal services are not published to the host.
- JWTs carry **real RBAC scopes** (resolved from the user's roles) and the gateway **strips
  client-supplied identity headers** before forwarding, setting trusted ones explicitly.
- Payments write a **double-entry ledger** that stays balanced through succeeds *and* refunds,
  and a reconciliation job verifies it.
- **Webhooks** are HMAC-verified *before* any state is persisted, and handler failures return a
  non-2xx so providers retry (no silent data loss).
- Dev credentials in `docker-compose.yml` are local-only defaults - override them via
  `POSTGRES_USER`/`POSTGRES_PASSWORD`, `RABBITMQ_USER`/`RABBITMQ_PASSWORD`, and
  `GRAFANA_USER`/`GRAFANA_PASSWORD` before anything non-local.

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and report security issues per
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

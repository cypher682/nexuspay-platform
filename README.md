# NexusPay Platform

[![CI](https://github.com/cypher682/nexuspay-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/cypher682/nexuspay-platform/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-20-green)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)
![PostgreSQL](https://img.shields.io/badge/postgres-16-blue)

Production-grade fintech platform built as a self-contained lab product to practice
real-world DevOps, cloud, infrastructure, and security engineering. Four
Node.js/TypeScript microservices behind an API gateway — with GitOps, container
security, API contract validation, and load testing — everything running locally
on Docker Desktop and minikube at **zero cloud spend**.

## What it is

NexusPay is a payment platform with:

- **JWT auth** with refresh-token rotation (reuse detection), TOTP MFA, RBAC scopes, and brute-force lockout
- **Idempotent payments** with a double-entry ledger, payment state machine, HMAC-verified provider webhooks, and reconciliation
- **Async notifications** (email/SMS) via RabbitMQ with templates, delivery tracking, and retries
- **API gateway** with JWT validation, sliding-window rate limiting (Redis), downstream circuit breaker, and correlated request IDs

> Monetary amounts are stored as **integer minor units** (kobo/cents). No floats anywhere.

## Architecture

```
                        ┌────────────────────┐
  Clients ──────────────►   api-gateway      │ :4000
                        │  JWT validation    │
                        │  rate limiting     │──┐
                        │  routing           │  │ Redis (rate limits,
                        └─────────┬──────────┘  │  correlation IDs)
                                  │             ▼
        ┌─────────────────────────┼──────────────────────┐
        ▼                         ▼                      ▼
┌────────────────┐      ┌──────────────────┐    ┌─────────────────────┐
│ auth-service   │      │ payments-service │    │ notifications-svc   │
│ :4001          │      │ :4002            │    │ :4003               │
│ JWT + rotation │      │ Idempotent       │    │ Template engine     │
│ TOTP MFA       │◄─────│ payment lifecycle│───►│ Email/SMS senders   │
│ RBAC + audit   │verify│ Ledger entries   │    │ RabbitMQ consumer   │
└───────┬────────┘      │ Inbound webhooks │    └──────────┬──────────┘
        ▼               └───────┬──────────┘               ▼
  nexuspay_auth                 ▼                    nexuspay_notifications
  (PostgreSQL)         nexuspay_payments              (PostgreSQL)
                        (PostgreSQL)

Shared: PostgreSQL 16 · Redis 7 · RabbitMQ 3.13
```

## Services

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 4000 | JWT validation, Redis sliding-window rate limiting, request routing, downstream circuit breaker, correlation IDs, `/v1/me/summary` aggregation |
| `auth-service` | 4001 | Register/login, refresh rotation with family reuse detection, TOTP MFA, RBAC, audit log, brute-force lockout |
| `payments-service` | 4002 | Idempotent payment processing, double-entry ledger, state machine, HMAC-verified provider webhooks, reconciliation |
| `notifications-service` | 4003 | Multi-channel delivery (email/SMS), template engine, RabbitMQ consumer, delivery tracking |

All services: TypeScript, Express 5, Prisma ORM, Zod validation, Winston structured logs, Jest tests, multi-stage Docker builds, health/readiness probes, non-root runtime user, BuildKit cache mounts, and committed lockfiles (`npm ci` builds).

## What's baked in (DevOps / Infra showcase)

- **CI/CD** — `.github/workflows/ci.yml`: changed-service matrix detection, lint + typecheck, unit tests, Docker build + push to GHCR with OCI cache, **Trivy** scanning (fail on CRITICAL), `npm audit`, OpenAPI drift validation, **Spectral** lint, and a k6 smoke test against the full compose stack.
- **GitOps** — Helm library chart + one chart per service (`values-dev`/`values-prod` overlays), ArgoCD `AppProject` + `ApplicationSet` (matrix generator over services × environments), Gatekeeper admission policies (allowed registries, required resources), secrets bootstrap script. See `infra/kubernetes/`.
- **Load testing** — k6 suites for smoke / auth login / payment flows with tunable thresholds and a documented seed for a verified test user. See `docs/k6-load-testing.md`.
- **API contract** — OpenAPI 3.1 spec, validated against actual source routes in CI (`scripts/validate-openapi.ts`) and linted with Spectral. Docs served at `/docs/` on the gateway.

## Repo structure

```
nexuspay-platform/
├── services/
│   ├── api-gateway/          # :4000  edge router, authN, rate limits, circuit breaker
│   ├── auth-service/         # :4001  IAM, MFA, RBAC, audit, lockout
│   ├── payments-service/     # :4002  idempotent payments, ledger, webhooks
│   └── notifications-service/# :4003  email/SMS via RabbitMQ
├── infra/
│   ├── kubernetes/           # helm/, argocd/, policies/, data/, scripts/
│   └── terraform/            # roadmap: provisioning (not yet written)
├── k6/                       # load-test scripts + local runner
├── scripts/                  # openapi drift validation, test-user seed
├── docs/                     # architecture, minikube guide, roadmap, load findings
├── .github/workflows/ci.yml
└── docker-compose.yml        # local stack: postgres + redis + rabbitmq + 4 services
```

## Quick start (local)

```bash
git clone https://github.com/cypher682/nexuspay-platform.git
cd nexuspay-platform

cp .env.example .env

# Build & start the full stack (postgres, redis, rabbitmq, 4 services)
docker compose up -d --build

# Apply migrations per service (each service's DB is a separate schema/database)
cd services/auth-service        && npx prisma migrate deploy
cd ../payments-service          && npx prisma migrate deploy
cd ../notifications-service     && npx prisma migrate deploy
cd ../..

# Gateway is the entrypoint
curl http://localhost:4000/health
```

RabbitMQ management UI: http://localhost:15672 (`nexuspay` / `nexuspay`).

> Postgres is published to the host as `localhost:5433` to avoid colliding with a
> locally-installed Postgres on 5432. Services reach each other on `postgres:5432`
> inside the compose network.

## Load testing & findings

```bash
# CI-equivalent smoke
k6 run k6/smoke-test.js

# Full load tests (auth login, payment flow) — seeds a verified user first
./k6/run-local.sh all
```

Phase-1 load testing surfaced and fixed three real production issues, all
documented in [`docs/k6-load-testing.md`](docs/k6-load-testing.md):

1. **Synchronous bcryptjs blocked the Node event loop** → gateway circuit breaker tripped → 503 cascade. Fixed with async `bcrypt.compare`, lower rounds in dev, larger threadpool, and a 5s downstream timeout.
2. **Gateway didn't proxy `/users`** → `/v1/users/me` returned 404 through the API. Route added.
3. **General rate limiter throttled payment load** → 429s during tests. Rate limits raised for load testing (kept tight in production).

## Kubernetes / GitOps

The GitOps layer in `infra/kubernetes/` is written and ready: Helm charts, ArgoCD
ApplicationSet, Gatekeeper policies, and a secrets-bootstrap script. A 16-section
guide walks through building the images, loading them into minikube (or a registry),
applying the stack, and smoke-testing it: [`docs/minikube-deployment-guide.md`](docs/minikube-deployment-guide.md).

The roadmap (Terraform for Azure/AKS, observability stack, additional services,
chaos/DR) is tracked in [`docs/lab-roadmap.md`](docs/lab-roadmap.md).

## Documentation

| Doc | What |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Design decisions, flow breakdown |
| [`docs/minikube-deployment-guide.md`](docs/minikube-deployment-guide.md) | Full minikube/GitOps deployment walkthrough |
| [`docs/k6-load-testing.md`](docs/k6-load-testing.md) | Load tests, thresholds, findings |
| [`docs/lab-roadmap.md`](docs/lab-roadmap.md) | 6-phase roadmap (all local, $0) |

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) and report security issues per
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
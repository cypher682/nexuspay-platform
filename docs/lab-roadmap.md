# NexusPay Platform — Lab Product Roadmap

> **Goal:** Build a production-grade fintech platform as a local lab product to practice DevOps, cloud, infrastructure, security, and documentation. Everything runs on minikube/Docker Desktop. Zero cloud spend.

---

## What Exists Now

### Core Platform (5 services + infrastructure)

| Service | Status | Endpoints | What it does |
|---------|--------|-----------|-------------|
| api-gateway :4000 | ✅ Done | 7 endpoints | JWT auth, rate limiting, circuit breaker, proxy, Swagger UI |
| auth-service :4001 | ✅ Done | 13 endpoints | Register, login, MFA (TOTP), RBAC, audit logs, brute-force protection |
| payments-service :4002 | ✅ Done | 11 endpoints | Payment state machine, BullMQ worker, idempotency, webhooks, reconciliation, double-entry ledger |
| notifications-service :4003 | ✅ Done | 6 endpoints | Email/SMS via RabbitMQ, templates, delivery attempts, retries |
| feature-flags-service :4004 | ✅ Live on k3s | 8 endpoints | Flag CRUD + audit, deterministic rollout/allowlist/variant evaluation, batch evaluate |

### Infrastructure (scaffolded, not tested on minikube yet)

| Component | Status | Notes |
|-----------|--------|-------|
| Docker Compose | ✅ Working | 13 containers, all healthy |
| Dockerfiles | ✅ Optimized | Multi-stage, non-root, healthchecks, cache mounts |
| Helm charts | ✅ Built | Library chart + 5 service charts with dev/prod values |
| ArgoCD | ✅ Built | AppProject + ApplicationSet (matrix: services × environments) |
| Gatekeeper policies | ✅ Built | Allowed repos + required resources (prod only) |
| Network policies | ✅ Built | Gateway-only mode for internal services |
| Bootstrap secrets | ✅ Built | Idempotent shell script |
| OpenAPI spec | ✅ Done | 3.1 spec, 41 documented routes, Swagger UI at /docs/ |
| Minikube guide | ✅ Done | 16-section guide with image loading, Helm deploy, smoke tests |
| Observability stack | ✅ Live on k3s | kube-prometheus-stack: Prometheus, Grafana, Alertmanager, kube-state-metrics, node-exporter; OTel SDK wired but tracing disabled, no Jaeger/Loki backend |
| SLO/Alerting | ✅ Live on k3s | 5 SLI recording rules + 6 alerting rules reconciled by ArgoCD; Alertmanager -> Mailpit verified |

### What's missing (the roadmap)

Everything below is organized into phases. Each phase builds on the previous one. All items run locally on minikube/Docker Desktop.

---

## Phase 1 — CI/CD Pipeline + Testing Foundation

**Why first:** Every real company has this. It gates everything else. Without it, you can't safely add features.

| # | What | Tool | Effort | What you practice | Status |
|---|------|------|--------|-------------------|--------|
| 1.1 | GitHub Actions CI workflow | GitHub Actions | 1 day | YAML pipelines, matrix builds, caching | ✅ |
| 1.2 | Lint + typecheck step | ESLint + tsc | 2 hours | Code quality gates | ✅ |
| 1.3 | Unit test step | Jest | 4 hours | Test coverage, parallel execution | ✅ |
| 1.4 | Docker build + push step | Docker BuildKit | 4 hours | Multi-arch builds, registry push | ✅ |
| 1.5 | Container scanning | Trivy | 2 hours | CVE scanning, severity thresholds | ✅ |
| 1.6 | Dependency audit | npm audit + Snyk | 2 hours | Supply chain security | ✅ |
| 1.7 | k6 load tests | k6 | 1 day | Performance baselines, thresholds | ✅ |
| 1.8 | OpenAPI spec validation | spectral | 2 hours | API contract testing | ✅ |

**Deliverables:**
- `.github/workflows/ci.yml` — lint → test → build → scan → push ✅
- `k6/` directory — load test scripts for each service ✅
- Green pipeline running on every push (CI runs smoke; full load tests run locally)
- `docs/k6-load-testing.md` — findings + how to run (see Phase 1 load findings) ✅

**Files to create/create:**
```
.github/workflows/ci.yml          ✅
k6/auth-login.js                  ✅
k6/payment-create.js              ✅
k6/gateway-smoke.js               ✅
scripts/seed-test-user.ts         ✅  (verified load-test user seed)
tests/ (expand existing test files)
```

**Phase 1 load-test findings** (see `docs/k6-load-testing.md`): sync bcryptjs
event-loop blocking tripped the gateway circuit breaker (fixed via async bcrypt +
rounds 10 + timeout 5s); gateway missing `/users` proxy (fixed); general rate
limiter throttled payment load (raised for tests); local Postgres port conflict
on 5432 (compose remapped to 5433).

---

## Phase 2 — Observability Stack

**Why second:** You can't operate what you can't see. This gives you metrics, logs, traces, and dashboards.

Live on k3s (verified 2026-10-30, see `docs/k3s-gitops-deployment.md` §6):

| # | What | Tool | Effort | What you practice | Status |
|---|------|------|--------|-------------------|--------|
| 2.1 | Prometheus metrics | prom-client + ServiceMonitor | 4 hours | RED metrics, ServiceMonitor CRDs | ✅ k3s |
| 2.2 | Grafana dashboards | kube-prometheus-stack | 4 hours | Dashboard design, GitOps ConfigMaps | ✅ k3s |
| 2.7 | Alerting rules | PrometheusRule + Alertmanager | 4 hours | Alert design, severity levels, SMTP routing | ✅ k3s |
| 2.8 | SLO/SLI definitions | Prometheus recording rules | 4 hours | Error budgets, burn rate alerts | ✅ k3s |

Scaffolded, not running on k3s yet:

| # | What | Tool | Effort | Why it is not done | Status |
|---|------|------|--------|--------------------|--------|
| 2.3 | Distributed tracing | OpenTelemetry SDK | 1 day | SDK initialised in all 4 services behind `OTEL_TRACES_ENABLED`, disabled until a backend exists | 🟡 |
| 2.4 | Jaeger backend | Jaeger Helm | 2 hours | No trace backend deployed anywhere yet | ❌ |
| 2.5 | Structured logging | Winston + JSON | 2 hours | Services emit JSON logs; no aggregation on k3s | 🟡 |
| 2.6 | Loki log aggregation | Fluent Bit + Loki Helm | 4 hours | `infra/monitoring/loki/loki-config.yaml` exists, nothing deployed | 🟡 |

**Deliverables (verified on k3s):**
- Prometheus scrapes all five services through ServiceMonitors rendered by the Helm library chart — 13/13 pods `up=1`
- Grafana with 29 stock dashboards plus `NexusPay - RED metrics` (request rate, 5xx ratio, p99, targets up), Prometheus + Alertmanager datasources auto-provisioned; ClusterIP only, reached with `kubectl port-forward`
- Alertmanager routes to Mailpit (`mailpit.nexuspay-data:1025`); an injected `NexusPaySmokeTest` alert was delivered and a real `NexusPayTargetDown` fired and resolved during the metrics-NetworkPolicy fix
- Alert rules for: error rate >1%, p99 latency >2s, queue depth >100, SLO burn rate (6x/14.4x), target down
- SLO recording rules: 99.5% availability, p99 latency SLI, burn rate (5m/1h windows) — 5 rules loaded, p99 series present for all 5 services
- `allow-metrics-ingress` NetworkPolicy is the only scrape path; the monitoring namespace is otherwise outside the app policy set

**Files:**
```
infra/kubernetes/monitoring/kube-prometheus-stack-values.yaml  # trimmed stack (7d, Mailpit, ClusterIP)
infra/kubernetes/monitoring/dashboards/nexuspay-red-dashboard.yaml
infra/kubernetes/alerts/nexuspay-alerts.yaml                   # SLO recording + alerting rules
infra/kubernetes/network-policies/allow-metrics-ingress.yaml
infra/monitoring/prometheus/rules/*.yml                        # Compose-era rules
infra/monitoring/alertmanager/alertmanager.yml                 # Compose-era config
```

---

## Phase 3 — Security Hardening

**Why third:** Now that you can see what's happening, lock it down. This is what interviewers care about most.

| # | What | Tool | Effort | What you practice | Status |
|---|------|------|--------|-------------------|--------|
| 3.1 | Network policies (enforce) | K8s NetworkPolicy | 4 hours | Deny-all default, explicit allows | ✅ |
| 3.2 | Pod security standards | Pod Security Admission | 2 hours | Restricted profile enforcement | ✅ |
| 3.3 | Vault dev server | HashiCorp Vault | 1 day | Dynamic secrets, lease management | ✅ |
| 3.4 | External Secrets Operator | ESO + Vault | 4 hours | Secret sync, rotation | ✅ |
| 3.5 | WAF / ModSecurity | nginx-ingress + ModSecurity | 4 hours | OWASP CRS rules, false positive tuning | ⬜ |
| 3.6 | JWT key rotation | CronJob + Vault | 4 hours | Automated rotation, zero-downtime | ✅ |
| 3.7 | RBAC audit | K8s RBAC + OPA | 4 hours | Least privilege, policy enforcement | ✅ |
| 3.8 | Image signing | Cosign | 2 hours | Supply chain security, verification | ✅ (scaffold) |
| 3.9 | Admission policies | Gatekeeper + rego | 4 hours | Deny unpinned images, unapproved registries, missing limits | ✅ |

**Deliverables:**
- Vault UI at `localhost:8200` (host `localhost:18200` on this Windows lab — 8200 sits in a default-excluded Hyper-V/WinNAT range) with dynamic database credentials
- Network policies blocking all inter-pod traffic except explicit flows (deny-all + least-privilege ingress/egress), applied to `nexuspay-prod`/`nexuspay-data` and E2E-verified
- PSA "restricted" enforced on app namespaces (`nexuspay-dev`, `nexuspay-prod`)
- Gatekeeper denies unpinned images, non-GHCR repos and containers without requests/limits in `nexuspay-prod`
- Service images pinned by digest (Deployments + PreSync migration Jobs)
- Dynamic Postgres creds issued by Vault, connect to Postgres, auto-revoked at 60s TTL (verified live)
- Zero-downtime JWT rotation: services verify against `JWT_SECRET` + `OLD_JWT_SECRETS`; unit-tested
- RBAC audited: no namespace Roles, no cluster bindings, SA tokens not mounted
- Cosign signing wired in CI but inactive until a key pair is configured

**Files to create / created:**
```
infra/kubernetes/vault/                 ✅ created (ESO + Vault dev server scaffold)
  vault-dev.yaml                        ✅ (in-cluster Vault dev + scoped-token bootstrap Job)
  external-secrets.yaml                 ✅ (operator version + ClusterSecretStore/SecretStore)
  vault-secrets.yaml                    ✅ (ExternalSecrets mirroring bootstrap-secrets.sh)
infra/kubernetes/network-policies/      ✅ created (8 files, 19 policy resources)
  deny-all.yaml, allow-gateway-ingress.yaml, allow-dns-egress.yaml,
  api-gateway-egress.yaml, auth-egress.yaml, payments-egress.yaml,
  notifications-egress.yaml, data-ingress.yaml
infra/kubernetes/security/
  pod-security.yaml                     ✅ created (PSA restricted on app namespaces)
  waf-config.yaml                       ⬜
infra/kubernetes/policies/              ✅ applied (Gatekeeper 3.23.1 + 3 templates/constraints)
infra/kubernetes/data/mailpit.yaml      ✅ created (SMTP sink, digest-pinned, no SA token)
scripts/vault-seed.sh                   ✅ created (Vault dynamic DB secrets, verified)
scripts/rotate-jwt-keys.sh              ✅ created (zero-downtime rotation, verified via unit tests)
```

**Phase 3.8 note:** Cosign signing steps were added to CI (`ci.yml` build job).
To activate signing, one manual one-time step is required: generate a Cosign key
pair, store `cosign.key` (base64) as the `COSIGN_PRIVATE_KEY` repo secret, and
place `cosign.pub` at the repo root (and paste its contents into
`signed-images.yaml`). Until then CI skips signing/verify gracefully.
policy-controller is not installed, so signature verification at admission is
inactive; Gatekeeper's digest constraint is the live control.

**Phase 3.5 / 3.7 / 3.9 status:** WAF/ModSecurity (3.5) is **not yet built** —
Traefik owns 80/443 on this cluster, so adding ingress-nginx means a deliberate
ingress-class migration. RBAC audit (3.7) is **done**: per-service SAs with
`automountServiceAccountToken: false` (default SAs patched too), no Roles in
`nexuspay-prod`, no ClusterRoleBindings for NexusPay identities; the only
binding is the Bitnami rabbitmq endpoint-reader (Endpoints read only).
Gatekeeper (3.9) is **live**: after switching off `enableK8sNativeValidation`
(which pointed at an unserved `vap.k8s.io` engine and admitted everything) and
fixing rego that read `spec.containers` instead of `spec.template.spec`, the
three constraints deny `nginx:latest` and resource-less containers while
admitting the digest-pinned manifests.

**Guardrails are GitOps-managed:** `nexuspay-platform-policies` and
`nexuspay-platform-netpol` reconcile the constraint templates/constraints and
the NetworkPolicies (AppProject cluster whitelist widened to the Gatekeeper
kinds). Gatekeeper itself is still installed imperatively, like cert-manager.
Verified by deleting a constraint and watching self-heal recreate it.

**Master reference:** `docs/engineering-reference.md` is the deep technical
writing that explains every tool, maps each to "how big companies run it," and
gives replication steps + article angles.

---

## Phase 4 — New Services

**Why fourth:** Now the platform is safe and observable. Add business logic.

### 4A. Fraud Detection Service

| # | What | Tool | Effort |
|---|------|------|--------|
| 4A.1 | New service scaffold | Express + Prisma | 4 hours |
| 4A.2 | Rules engine | In-memory rules | 1 day |
| 4A.3 | Velocity checks | Redis sliding window | 4 hours |
| 4A.4 | Amount threshold rules | Config-driven | 2 hours |
| 4A.5 | Integration with payments | Sync call before SUCCEEDED | 4 hours |
| 4A.6 | Dashboard endpoint | Risk scores, blocked transactions | 4 hours |

**Prisma models:** `FraudRule`, `FraudCheck`, `RiskScore`
**Pattern:** payments-service calls fraud-service synchronously → if blocked, payment stays PROCESSING

### 4B. Feature Flags Service

**Status: shipped and verified live on k3s (2026-10-31).** Deviations from the original sketch:
the store is Postgres (`nexuspay_featureflags`), not Redis; there is no in-process SDK yet —
callers use the gateway-fronted HTTP API. The service adds an append-only audit log, variant
assignment, allowlists and batch evaluation. Design and runbook: [feature-flags.md](feature-flags.md).

| # | What | Tool | Status |
|---|------|------|--------|
| 4B.1 | Flag store | Postgres + Prisma (was: Redis) | ✅ Done |
| 4B.2 | Deterministic evaluation | SHA-256 bucket + allowlist + master switch | ✅ Done |
| 4B.3 | Admin API | CRUD + audit, `flags:admin` scope | ✅ Done |
| 4B.4 | SDK for services | Shared package | ❌ Not started (HTTP API instead) |

**Use cases:** Toggle new payment providers, enable MFA for segments, kill-switch for notifications

### 4C. Reporting Service

| # | What | Tool | Effort |
|---|------|------|--------|
| 4C.1 | New service scaffold | Express + Prisma | 4 hours |
| 4C.2 | Materialized views | PostgreSQL | 4 hours |
| 4C.3 | Scheduled reports | CronJob (K8s) | 4 hours |
| 4C.4 | Revenue dashboard | Grafana panel | 4 hours |
| 4C.5 | Export endpoints | CSV/JSON | 4 hours |

**Deliverables:**
- 3 new services (fraud, flags, reporting) — flags shipped on k3s; fraud and reporting not started
- Fraud checks visible in traces
- Feature flags toggling behavior live ✅
- Revenue dashboard in Grafana

---

## Phase 5 — Chaos Engineering + Resilience

**Why fifth:** Now you have a complex system. Break it on purpose to prove it's resilient.

| # | What | Tool | Effort |
|---|------|------|--------|
| 5.1 | Litmus Chaos | Litmus Helm | 4 hours |
| 5.2 | Pod kill experiments | Chaos Hub experiments | 4 hours |
| 5.3 | Network latency injection | Litmus faults | 4 hours |
| 5.4 | CPU/memory stress | Litmus faults | 2 hours |
| 5.5 | Game day runbooks | Markdown | 1 day |
| 5.6 | Post-incident review template | Markdown | 2 hours |
| 5.7 | Circuit breaker verification | k6 + Litmus | 4 hours |
| 5.8 | Backup/restore drills | Velero + pg_basebackup | 4 hours |

**Deliverables:**
- `chaos/` directory with experiment YAMLs
- `runbooks/` directory with per-service runbooks
- Documented game day procedures
- Backup scripts that actually work

**Files to create:**
```
chaos/
  pod-kill-auth.yaml
  network-latency-payments.yaml
  cpu-stress-notifications.yaml
  disk-fill-redis.yaml
runbooks/
  auth-service-down.md
  payments-slow.md
  rabbitmq-queue-backlog.md
  database-connection-exhausted.md
scripts/
  backup-db.sh
  restore-db.sh
  failover-test.sh
```

---

## Phase 6 — Deployment Strategy + Developer Experience

**Why last:** Now you have everything. Make it easy to operate and extend.

| # | What | Tool | Effort |
|---|------|------|--------|
| 6.1 | Canary deployments | Argo Rollouts | 1 day |
| 6.2 | Automated rollback | AnalysisTemplate | 4 hours |
| 6.3 | Admin dashboard | Next.js | 2 days |
| 6.4 | Status page | Uptime Kuma | 2 hours |
| 6.5 | ADRs | Markdown | 4 hours |
| 6.6 | CONTRIBUTING.md | Markdown | 2 hours |
| 6.7 | Architecture docs | Mermaid diagrams | 4 hours |
| 6.8 | Engineering blog posts | Dev.to | 1 day |

**Deliverables:**
- Canary rollout visible in ArgoCD UI
- Admin dashboard at `localhost:3001`
- Status page at `localhost:3002`
- Complete documentation suite

---

## Implementation Priority (what to do first)

```
Week 1-2:  Phase 1 — CI/CD + k6 + container scanning
Week 3-4:  Phase 2 — Prometheus + Grafana + Jaeger + Loki + alerts
Week 5-6:  Phase 3 — Vault + network policies + pod security + WAF
Week 7-8:  Phase 4A — Fraud detection service
Week 9-10: Phase 4B-4C — Feature flags + reporting (4B shipped first, 2026-10-31)
Week 11-12: Phase 5 — Chaos engineering + runbooks + DR
Week 13-14: Phase 6 — Canary deploys + admin dashboard + docs
```

---

## Running Locally — Quick Reference

### Start everything
```bash
cd F1/nexuspay-platform
docker compose up --build
```

### Access services
| Service | URL |
|---------|-----|
| API Gateway | http://localhost:4000 |
| Swagger UI | http://localhost:4000/docs/ |
| Auth Service | http://localhost:4001 |
| Payments Service | http://localhost:4002 |
| Notifications Service | http://localhost:4003 |
| Feature Flags Service | http://localhost:4004 |
| RabbitMQ UI | http://localhost:15672 |

### After Phase 2 (observability)
| Tool | URL |
|------|-----|
| Grafana | http://localhost:3000 |
| Jaeger | http://localhost:16686 |
| Prometheus | http://localhost:9090 |
| Alertmanager | http://localhost:9093 |

### After Phase 3 (security)
| Tool | URL |
|------|-----|
| Vault | http://localhost:18200 (Windows host; 8200 in-setup elsewhere) |

### After Phase 6 (DX)
| Tool | URL |
|------|-----|
| Admin Dashboard | http://localhost:3001 |
| Status Page | http://localhost:3002 |

---

## What Each Phase Practices

| Phase | DevOps | Cloud | Security | Dev |
|-------|--------|-------|----------|-----|
| 1. CI/CD | GitHub Actions, Docker | Registry concepts | Container scanning | Testing |
| 2. Observability | Helm, Prometheus | Metrics pipeline | — | Instrumentation |
| 3. Security | Vault, ESO, OPA | — | WAF, RBAC, signing | — |
| 4. Services | Helm, K8s | Service mesh concepts | API auth | Feature design |
| 5. Chaos | Litmus, Velero | DR strategies | Resilience testing | — |
| 6. DX | Argo Rollouts | Canary strategies | — | Documentation |

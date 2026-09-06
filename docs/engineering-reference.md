# NexusPay Platform — Master Engineering Reference

> A personal, technical deep-dive into how the NexusPay platform is built and
> operated, written as a **replicable playbook**. Every section maps a real,
> working piece of NexusPay to a pattern big companies use, explains *why* it
> matters, and shows the exact files/commands to reproduce it in any project.
>
> Use this file to: (1) refresh your own understanding before interviews or
> demos, (2) copy the pattern into a new project, and (3) mine topics for
> Dev.to / LinkedIn articles. Each section ends with "→ Article angle".

---

## 0. The Big Picture — why this repo is structured this way

NexusPay is a microservice fintech lab. The point is not the services themselves —
it is the **surrounding platform machinery**: CI/CD that gates everything, an
observability stack that lets you see it, a security posture that locks it
down, and a GitOps deployment model that makes change auditable.

Big companies run the same stack, just at larger scale and with more ceremony.
The four pillars:

```
  1. CI/CD + Testing   → gated change (lint→test→scan→push→smoke)
  2. Observability     → metrics, logs, traces, alerting, SLOs
  3. Security          → defense in depth (net, pod, secrets, keys, supply chain)
  4. Delivery          → GitOps (ArgoCD), Helm, namespaces, promotion dev→prod
```

Everything below the application code lives in **infra/** and is declarative
(version-controlled YAML), because *"it's reproducible or it didn't happen."*

---

## 1. Repository Layout (what lives where and why)

```
.
├── services/                 # 4 microservices (gateway, auth, payments, notifications)
├── k6/                       # load + smoke tests (performance gate)
├── docs/                     # architecture, runbooks, security, roadmap
├── infra/
│   ├── monitoring/           # prometheus rules, alertmanager, loki/grafana config
│   └── kubernetes/
│       ├── helm/             # library chart + 4 service charts (dev/prod values)
│       ├── argocd/           # AppProject + ApplicationSet (matrix)
│       ├── policies/         # Gatekeeper admission policies
│       ├── network-policies/ # deny-all + explicit flows
│       ├── security/         # PSA labels + JWT rotation CronJob/RBAC
│       ├── vault/            # Vault dev + ESO (secret management)
│       ├── data/             # datastore install guide
│       └── scripts/          # bootstrap-secrets.sh
├── scripts/                  # vault-seed.sh, rotate-jwt-keys.sh, openapi helpers
├── .github/workflows/ci.yml  # the entire pipeline
└── docker-compose.yml        # local dev stack (14 services incl. vault)
```

**The big-company habit:** infrastructure is *code in the same repo* as the app
("monorepo with infra as code"), so every PR shows both the app change and the
infra change together, and CI validates both.

→ **Article angle:** "Infrastructure as Code — the GitOps repo layout that
makes a solo project feel like a platform team."

---

## 2. CI/CD Pipeline (`.github/workflows/ci.yml`)

### What it does, step by step

| Stage | Job | Gate | Practice |
|-------|-----|------|----------|
| Change detection | `changes` | dorny/paths-filter | Only run what changed (build time, cost) |
| Lint/typecheck | `lint` | ESLint + `tsc --noEmit` (all 4 svcs) | Quality gate |
| Config validation | `lint` | promtool + amtool | Validate rule/alert config in CI |
| Unit tests | `test` (matrix) | Jest per changed service | Behavioral correctness |
| Build + push | `build` (matrix) | BuildKit → GHCR | Container pipeline |
| Scan | `build` | Trivy (CRITICAL, exit 1) | CVE gate |
| Sign | `build` | Cosign (skips if no key) | Supply chain |
| Dependency audit | `audit` | `npm audit --audit-level=high` | Supply chain |
| OpenAPI | `openapi` | validate-openapi + spectral | API contract |
| Load smoke | `k6-smoke` | full compose up + k6 | Integration reality check |

### Why path-based matrix matters
The `changes` job computes which services changed and produces a JSON matrix.
Unchanged services skip `test` + `build`. This is the standard way big platforms
keep large monorepos fast — "build only what you touched."

### The supply-chain layers (defense in depth)
1. **Trivy** scans the built image for CRITICAL CVEs (fails the build).
2. **npm audit** fails on `high`/`critical` dependency vulns.
3. **Cosign** signs the pushed image (with the repo `COSIGN_PRIVATE_KEY`), and
   verifies it against the checked-in `cosign.pub`.
4. **Gatekeeper** (admission) rejects prod images not pinned by digest.

### Key implementation notes / gotchas
- **`--entrypoint` for promtool/amtool**: the prometheus image's default
  entrypoint is the server binary; you must override with `--entrypoint promtool`
  (and `amtool`) or the check commands silently misbehave.
- **`secrets` context is not allowed in step `if:` conditions.** Route secrets
  through a job-level `env:` var and gate steps on `env.VAR != ''`.
- The Cosign key is base64 stored as a repo secret; until it's configured, sign
  + verify steps **skip gracefully** so the pipeline stays green.

> Replicate: copy the workflow, wire the 4 service paths, add your secrets.
> The structure (changes → lint/test matrix → build matrix → scan → smoke) is
> the "reference pipeline" pattern.

→ **Article angle:** "A reference GitHub Actions pipeline for a microservice
repo — path-based matrices, Trivy, npm audit, and Cosign, wired so it stays
green out of the box."

---

## 3. Observability (metrics, logs, traces, alerting, SLOs)

Stack (docker-compose accross infra/monitoring/):
**Prometheus** (metrics) + **Grafana** (dashboards) + **Jaeger/OTel** (traces)
+ **Loki** (logs) + **Alertmanager** (alerting → Mailpit SMTP).

### RED metrics per service
Each service exposes `/metrics` via prom-client. The signal set is **RED**:
- **R**ate – requests/sec
- **E**rrors – error rate (5xx / total)
- **D**uration – latency histogram (p50/p95/p99)

These are the three numbers every backend SRE watches first.

### SLOs as recording rules
`infra/monitoring/prometheus/rules/recording_rules.yml` precomputes SLIs so
alerts are cheap and dashboards are fast:
- Availability SLI (99.5% target)
- p99 latency SLI
- Burn rate over 5m / 1h windows

**The big-company concept:** an **error budget**. If the service uses more than
X% of its 30-day budget in a short window, you page. Burn-rate alerts (6x /
14.4x) catch fast and slow consumption.

### Alerting rules
`alerting_rules.yml` fires on: error rate > 1%, p99 > 2s, queue depth > 100,
SLO burn rate, target down. Alerts route to Alertmanager → mail / Mailpit.

### Important gotcha
Prometheus' `mul`/`div` template functions are **not defined** in annotations —
use `humanizePercentage`, `humanizeDuration`, or `printf`. (Real bug fixed in
this repo.)

**Files:** `infra/monitoring/prometheus/rules/*.yml`, `alertmanager/alertmanager.yml`,
`docs/observability.md`.

> Replicate: add `/metrics` to your service, write RED recording rules, add
> alert rules, wire Alertmanager to a mail target. That's a production-mimimal
> SRE setup.

→ **Article angle:** "RED metrics, SLOs, and burn rates — a practical minimal
observability stack for a microservice (Prometheus + Loki + Jaeger + Alertmanager)."

---

## 4. Security (defense in depth — the full arc)

This is the flagship story. Six layers, each independently enforceable:

### 4.1 Network policies — zero trust east-west
`infra/kubernetes/network-policies/`
- `deny-all.yaml` : denies ALL ingress+egress in every app namespace (baseline).
- Then specific `*-egress.yaml` re-allow only what each service needs:
  gateway→services, auth→postgres:5432, payments→postgres/redis/rabbitmq,
  notifications→postgres/rabbitmq/mailpit, data-* ingress from correct pods,
  plus DNS egress.
- **Why:** default-deny network means a compromised pod can't freely move
  sideways. This is the difference between "app is secure" and "blast radius
  is bounded."

### 4.2 Pod Security Admission — refuse to run unsafe pods
`infra/kubernetes/security/pod-security.yaml`
Namespaces labeled `pod-security.kubernetes.io/enforce: restricted`. Any pod
that runs as root, escalates privileges, or lacks seccomp is **rejected at the
API server**, not by policy agents. The Helm library chart already renders
restricted-compliant workloads, so enforcement is possible without breakage.

### 4.3 Secrets: don't bake them into images or git
- **Compose:** HashiCorp Vault dev server (host `localhost:18200`) with a
  **dynamic Postgres credentials** engine (`scripts/vault-seed.sh`).
  - Service can mint a DB user, connect, and the user is **auto-revoked at 60s
    TTL**. Verified live: mint → connect → after TTL, `password authentication failed`.
  - This is the "ephemeral credential" pattern big platforms use to avoid
    long-lived static DB passwords.
- **K8s:** External Secrets Operator (ESO) scaffold
  (`infra/kubernetes/vault/`) syncs Vault KV values into native Secrets the
  charts already consume. Delete the manually-bootstrapped secret and ESO owns it.

### 4.4 Zero-downtime JWT key rotation
`scripts/rotate-jwt-keys.sh` (`rotate` / `expire`).
- **The contract:** services verify against `JWT_SECRET` **and** the
  comma-separated `OLD_JWT_SECRETS`.
- `rotate`: new key becomes current, old key appended to the accept list, then
  rolling restarts. Old tokens keep working → no logouts, no downtime.
- `expire`: after the grace window (24h), remove the old key.
- Code: `services/{auth,gateway,payments}/src/lib/tokens.ts` multi-key verify;
  unit-tested (`tests/tokens.rotation.test.ts`).
- Also: a CronJob + least-privilege RBAC scaffold for scheduled rotation.

**The big-company concept:** rotate on a schedule, keep both keys during a grace
window, sweep old keys after — the same pattern banks use for signing keys.

### 4.5 Image signing + verification (supply chain)
- CI signs with Cosign, verifies with the public key.
- `policies/k8srequireimagedigest-template.yaml` : Gatekeeper rejects any prod
  image not pinned by `@sha256:` digest (mutable tags forbidden).
- `policies/signed-images.yaml` : sigstore policy-controller ClusterImagePolicy
  for actual cryptographic signature verification at admission.

### 4.6 Data encryption-at-rest / defense notes
- Passwords hashed with bcrypt (async, rounds 12).
- MFA via TOTP (otplib) — a shared secret per user.
- (Audit follow-up flagged: encrypt MFA secrets + a durable idempotency scheme —
  see roadmap.)

**Files:** see `docs/security.md` for the full file map.

> Replicate: the order matters — enforce pods are safe (PSA) → bound the
> network (NetworkPolicy) → stop baking secrets (Vault/ESO) → rotate keys
> safely → sign/verify images. Each is independent and verifiable on its own.

→ **Article angle:** "Six layers of defense-in-depth for a microservice, from
NetworkPolicy to Cosign — a copy-paste security posture built with open source."

---

## 5. GitOps Delivery (ArgoCD + Helm)

- **Helm library chart** (`infra/kubernetes/helm/nexuspay-lib`) + 4 service
  charts with `values.yaml` (dev) and `values-prod.yaml` (prod). DRY: security
  context, probes, HPA, PDB, NetworkPolicy all rendered from templates.
- **ArgoCD** `AppProject` + **ApplicationSet** using a *matrix* over
  services × environments → creates `nexuspay-dev` / `nexuspay-prod` and syncs
  each chart automatically.

**The big-company model:** Git is the single source of truth. You don't run
`kubectl apply` by hand for workloads; you merge to `main`, ArgoCD sees the
diff, and applies it. Promotion dev→prod is a git change, so it's reviewable
and auditable.

> Replicate: one library chart + one ApplicationSet with a matrix is the
> sweet spot for N services × M environments.

→ **Article angle:** "Helm + ArgoCD ApplicationSet: GitOps for many services
without N copy-pasted charts."

---

## 6. Reproducing it in a new project — the 30-minute pattern

Given any backend service (Express/FastAPI/etc.):

1. **Add `/metrics`** (prom-client) and structured JSON logs + trace IDs.
2. **Write a Dockerfile** — multi-stage, non-root, read-only, healthcheck.
3. **Add the CI job** — copy the `changes`/`lint`/`test`/`build`/`scan` skeleton.
4. **Point a compose file** at prometheus/grafana/loki/jaeger/alertmanager;
   bring it up; browse the dashboards.
5. **Add NetworkPolicy deny-all + allow** for its port; add PSA `restricted` label.
6. **Store secrets in Vault** (or a secrets manager) — never in git.
7. **Wrap it in Helm + an ApplicationSet.**

Each step is independently valuable and independently demonstrable, which makes
them perfect for incremental articles.

---

## 7. What's done, what remains (status snapshot)

### Done (verifiable)
- Phase 1 CI/CD: lint, test, build, Trivy, npm audit, openapi, k6 ✅ (all green)
- Phase 2 Observability: RED metrics, Grafana, Jaeger, Loki, Alertmanager, SLO/burn-rate ✅
- Phase 3 Security: NetworkPolicies, PSA, Vault dynamic creds (live-verified),
  ESO scaffold, JWT rotation (unit-tested), Cosign + digest-pinning + policy-controller ✅

### Remaining in the roadmap
- **Phase 3.5 WAF / ModSecurity** (nginx-ingress + OWASP CRS) — not built.
- **Phase 3.7 RBAC audit** (K8s RBAC + OPA) — partially scaffolded only.
- **Activate Cosign**: generate a key pair, set `COSIGN_PRIVATE_KEY` repo
  secret, place `cosign.pub` at repo root + in `signed-images.yaml`.
- **Deferred audits** (from earlier): MFA secret encryption at rest, durable
  idempotency, Trivy HIGH threshold vs CRITICAL, immutable image tags in dev.
- **In-cluster verify**: manifests are declarative + validated, but not yet
  enforced on a live minikube cluster (NetworkPolicy/PSA/ESO/webhooks need a
  running cluster to prove).

### Phase 4+ (future)
Fraud detection, feature flags, reporting; chaos engineering (Litmus); canary
deploys (Argo Rollouts), admin dashboard, status page, ADRs.

---

## 8. Post now or continue? — recommendation

The platform is at a **strong, postable milestone**. Phase 1–3 are done and
green, and you have real "war stories": the Windows port-exclusion debugging,
the prometheus template-function fix, the live Vault dynamic-credential verify,
the `secrets`-in-`if` CI gotcha, and the multi-key rotation design.

**Recommended: start posting now, in parallel with continuing.** Don't wait for
Phase 6 — the engineering narrative is already compelling, and writing articles
forces you to sharpen the code and find gaps (which feeds back into the repo).

Suggested article series (each maps to a section above):
1. **"I built a production-grade fintech platform alone"** — the four pillars + repo tour.
2. **"A reference GitHub Actions pipeline for microservices"** — Section 2.
3. **"Minimal observability: RED, SLOs, burn rates with Open Source"** — Section 3.
4. **"Six layers of defense-in-depth for a microservice"** — Section 4.
5. **"Helm + ArgoCD ApplicationSet: GitOps without chart sprawl"** — Section 5.
6. **"Zero-downtime JWT key rotation"** — Section 4.4.
7. **"Vault dynamic database credentials, verified"** — Section 4.3.
8. **"Debugging Hyper-V port exclusion ranges on Windows"** — Section 2/3 gotchas.

Post each article with a link back to the repo. As you add Phase 4+ services,
follow each with a new article — the series grows the platform and your
portfolio together.

---

## 9. One-paragraph pitch for interviews / LinkedIn

> NexusPay is a microservice fintech platform I designed and built end-to-end:
> four services, a CI/CD pipeline that lints, tests, scans (Trivy/npm audit),
> signs (Cosign), and smoke-tests every change; a full observability stack with
> RED metrics, SLOs, burn-rate alerts, distributed tracing, and log aggregation;
> and a defense-in-depth security posture including default-deny network
> policies, Pod Security Admission "restricted", HashiCorp Vault dynamic
> database credentials, zero-downtime JWT key rotation, and image-signature
> admission control — all delivered through GitOps with Helm and ArgoCD. It's
> the kind of aligned "platform + app" evidence that shows I can both write code
> and operate at the platform layer.

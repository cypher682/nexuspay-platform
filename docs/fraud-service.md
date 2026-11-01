# Fraud Service

**Status: verified live on k3s** (2 pods, Synced/Healthy, `up=1`, ALLOW/BLOCK/REVIEW decisions
persisted and exercised through real payments).

`fraud-service` (:4005) scores payments synchronously before the provider is charged.
Rules are data, not code: thresholds, velocity counters and denylists are stored in Postgres
and can be changed without a deploy. Every decision is persisted with its reasons and latency.

The payments worker calls `POST /v1/fraud/check` over the internal network with the shared
`x-internal-api-key`. The service is **not routed through the gateway**; admin read/update
endpoints are reached in-cluster (port-forward) with a JWT carrying `*` or `fraud:admin`.

## Data model

| Object | Purpose |
|---|---|
| `fraud_rules` | `AMOUNT_THRESHOLD`, `VELOCITY`, `DENYLIST` rules with `score`, `enabled`, JSON `config` |
| `fraud_checks` | One row per decision: `paymentId`, `userId`, `amountMinor`, `decision`, `score`, `reasons[]`, `latencyMs` |

Seeded by the initial migration: `amount_threshold` (₦100k / 10,000,000 kobo, score 60),
`velocity_5_per_5m` (5 checks / 300s, score 60), `denylist` (score 100, empty by default).

## Decision logic

```
score = min(100, sum of matching rule scores)
BLOCK  if any denylist hit, or score >= FRAUD_BLOCK_SCORE (default 70)
REVIEW if score >= FRAUD_REVIEW_SCORE (default 40)
ALLOW  otherwise
```

- **Amount** matches only if the rule's optional `currency` equals the payment currency.
- **Velocity** counts checks per user in Redis (`fraud:velocity:<userId>`, INCR + EXPIRE) before
  the current check; the largest enabled velocity window is used.
- **Denylist** matches `userId` exactly or `email` case-insensitively.
- Malformed rule config is skipped, never fatal; the engine is unit-tested against that case.

## API (internal)

| Method & path | Auth | Notes |
|---|---|---|
| `POST /v1/fraud/check` | internal API key | body `{paymentId?, userId, amountMinor, currency?, email?}` → 201 decision |
| `GET /v1/fraud/checks` | JWT `fraud:admin`/`*` | `?limit` (≤200), `?decision=ALLOW\|REVIEW\|BLOCK` |
| `GET /v1/fraud/stats` | JWT `fraud:admin`/`*` | 24h counts by decision + average latency |
| `GET /v1/fraud/rules` | JWT `fraud:admin`/`*` | all rules |
| `PATCH /v1/fraud/rules/{id}` | JWT `fraud:admin`/`*` | `enabled`, `score`, type-validated `config` |

`/health`, `/health/live`, `/health/ready`, `/metrics` are standard.

## Payments integration and failure mode

In `services/payments-service/src/workers/payment.worker.ts`, after the payment moves to
`PROCESSING`:

- `BLOCK` → `markFailed(paymentId, "fraud_blocked:<reasons>")`; the provider is never charged.
- `REVIEW` → logged (`worker.payment_flagged_for_review`) and the payment proceeds.
- Service unreachable or 1.5s timeout → **fail-open**: logged (`fraud.check_unavailable`) and
  the payment proceeds. This is deliberate availability-over-strictness for a lab; a real
  deployment would queue for manual review or fail closed for high-value corridors.

## Deployment

- Chart: `infra/kubernetes/helm/services/fraud-service` (library chart; `networkPolicy.mode:
  payments-only`).
- DB: `nexuspay_fraud` on the shared Postgres; secret `fraud-db` (`url`) in `nexuspay-prod`.
- Redis: shared instance, no auth; egress allowed to `redis:6379` and `postgres:5432` only.
- Migration: PreSync Job with its own hook ServiceAccount.
- Metrics: `fraud_checks_total{decision}`, `fraud_rule_hits_total{rule}`,
  `fraud_velocity_errors_total`, plus standard RED metrics.

## Evidence (verified 2026-11-01)

```console
$ kubectl -n argocd get app nexuspay-fraud-service-prod            # Synced Healthy
$ kubectl -n nexuspay-prod get pods -l app.kubernetes.io/name=fraud-service   # 2/2 Running
# Payments deployment runs the fraud-enabled digest sha256:dc6f2cc7..., 3/3 Ready

POST /v1/payments  50,000 kobo   -> SUCCEEDED  cmvxpcocx0002dk0193lw3iuf
                                   fraud_checks: ALLOW  score 0  latency 9ms
POST /v1/payments  20,000,000    -> SUCCEEDED  cmvxpcvai0002dl01y89echni
                                   fraud_checks: REVIEW score 60 {amount_threshold} 3ms
PATCH /v1/fraud/rules/rule_denylist {userIds:[testUser]}
POST /v1/payments  75,000 kobo   -> FAILED     cmvxpdm2t0008cs01s6ff6pdx
                                   failureReason "fraud_blocked:denylist"
                                   fraud_checks: BLOCK score 100 4ms
PATCH denylist back to []

# Prometheus
up{job="fraud-service"}                    -> 1 for 10.42.0.126:4005 and 10.42.0.127:4005
sum by (decision) (fraud_checks_total)     -> ALLOW 2, REVIEW 2, BLOCK 2
```

Rules seeded by the initial migration and returned by `GET /v1/fraud/rules`:
`rule_amount_threshold` (60), `rule_velocity` (60, 300s/5 checks), `rule_denylist` (100).

## Runbook

- **Stop a fraudster now:** `PATCH /v1/fraud/rules/rule_denylist` with the user id/email.
- **Kill switch for the gate:** `PATCH` the rule with `{"enabled": false}`; payments fall back
  to provider-only decisions.
- **Tune sensitivity:** change a rule's `score` or `FRAUD_BLOCK_SCORE`/`FRAUD_REVIEW_SCORE`
  (env, requires rollout); thresholds are validated 0–100.
- **Capacity check:** `GET /v1/fraud/stats` (avg latency) and the RED dashboard.

## Known limits

- No ML model: rules only. The roadmap's "RiskScore" model was not created as a separate table;
  score is stored on each check.
- Velocity counters are per-user, not per-card/device/IP, and Redis loss resets windows.
- Fail-open on timeout; no retry queue and no manual-review workflow for REVIEW decisions.
- Rule changes are not audited (feature flags has the audit-log pattern; fraud does not yet).
- No UI; admin endpoints are in-cluster only.

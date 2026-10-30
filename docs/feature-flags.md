# Feature Flags Service

**Status: verified live on k3s** (2 pods, Synced/Healthy, Prometheus target `up=1`).

`feature-flags-service` (:4004) lets the platform change behaviour without redeploying:
kill switches, percentage rollouts, allowlists, and A/B variants — with an audit trail for
every mutation. It sits behind the gateway (`/v1/flags`) and owns the `nexuspay_featureflags`
Postgres database.

## Data model

| Table | Purpose |
|---|---|
| `flags` | One row per `(environment, key)`: `enabled`, `rolloutPercent`, `variants[]`, `allowlist[]`, `createdBy`/`updatedBy` |
| `flag_audit_logs` | Append-only `create` / `update` / `delete` entries with `before`/`after` JSON and actor id |

Uniqueness is `(environment, key)`; `key` matches `^[a-z][a-z0-9._-]{1,63}$`.

## Evaluation

Deterministic and dependency-free (no Redis round-trip):

1. **Master switch off** → `enabled=false`, reason `flag_disabled`. Allowlists do not override a kill switch.
2. **Subject on the allowlist** → `enabled=true`, reason `allowlist`.
3. **Bucket < rollout** → `enabled=true`, reason `rollout`; otherwise `not_in_rollout`.
4. **Unknown flag** → `enabled=false`, reason `flag_not_found` (HTTP 200, SDK-friendly).

Bucket: `sha256("<environment>:<key>:<subjectId>")`, first 32 bits mod 10000, compared against
`rolloutPercent * 100`. Variant: `sha256("variant:...")` bytes 4–8 mod `variants.length`.
Same subject + flag always gets the same answer, and staging can differ from prod because the
environment is part of the hash input.

## API (through the gateway)

| Method & path | Auth | Notes |
|---|---|---|
| `GET /v1/flags` | access token | `?environment=prod&limit=50` |
| `POST /v1/flags` | `flags:admin` or `*` | 409 on duplicate key |
| `GET /v1/flags/{key}` | access token | |
| `PATCH /v1/flags/{key}` | `flags:admin` or `*` | partial update, audited |
| `DELETE /v1/flags/{key}` | `flags:admin` or `*` | audited |
| `GET /v1/flags/{key}/audit` | `flags:admin` or `*` | newest first |
| `POST /v1/flags/{key}/evaluate` | access token | body `{subjectId?}` (defaults to caller) |
| `POST /v1/flags/evaluate` | access token | batch `{keys?, subjectId?}`, max 100 |

The admin scope comes from the auth service: the `admin` role carries `*`, so any user with
that role passes. Non-admin calls to mutating routes return `403`.

## Deployment

- Chart: `infra/kubernetes/helm/services/feature-flags-service` (uses the shared `nexuspay-lib`).
- Image: arm64 digest pinned in `values-prod.yaml`; built by the **Publish** workflow.
- Secret: `feature-flags-db` (`url`) in `nexuspay-prod`, pointing at `nexuspay_featureflags`
  on the shared `postgres-postgresql` instance.
- Migration: PreSync Job runs `prisma migrate deploy` with its own hook ServiceAccount.
- NetworkPolicy: ingress only from `api-gateway`; egress only to postgres `5432`;
  Prometheus scrape allowed from the `monitoring` namespace on `4004`.
- Metrics: standard RED metrics plus `feature_flag_evaluations_total{result}` and
  `feature_flag_changes_total{action}`. The RED dashboard picks the service up via
  `label_values`, no dashboard edit needed.

## Evidence

```bash
kubectl -n argocd get application nexuspay-feature-flags-service-prod   # Synced Healthy
kubectl -n nexuspay-prod get pods -l app.kubernetes.io/name=feature-flags-service  # 2/2 Running
kubectl -n nexuspay-data exec postgres-postgresql-0 -- psql -U nexuspay -d nexuspay_featureflags -c '\dt'
# flags, flag_audit_logs, _prisma_migrations

# through the gateway (admin token):
POST /v1/flags            -> 201 {key: "checkout-redesign", enabled: true, rolloutPercent: 100}
POST /v1/flags/checkout-redesign/evaluate {"subjectId":"user-42"}
                          -> {"enabled":true,"variant":"treatment","reason":"rollout"}
POST /v1/flags/evaluate   -> missing-flag returns reason "flag_not_found"
GET  /v1/flags/checkout-redesign/audit -> count 1, action "create"
POST /v1/flags (non-admin) -> 403
```

Prometheus: `up{job="feature-flags-service"}` = 1 for both pods;
`feature_flag_evaluations_total` increments after evaluations.

## Runbook

- **Kill switch:** `PATCH /v1/flags/{key}` with `{"enabled": false}` — takes effect on the next evaluation.
- **Canary:** set `rolloutPercent` to 5 → 25 → 100; watch `feature_flag_evaluations_total{result}`.
- **Targeted testers:** add subject ids to `allowlist` (works even at 0%).
- **Rollback a change:** the audit log stores the previous object; re-apply it via `PATCH`.

## Known limits

- No client SDK yet: callers use the HTTP API (gateway-fronted) rather than an in-process library.
- Every evaluation is a Postgres read; there is no cache or change stream. Fine at lab scale,
  not a design for very high QPS.
- Environments are free-form strings (`prod`, `staging`, …); there is no separate environment
  object or promotion workflow.
- Audit retention is unbounded; there is no pruning job.
- No UI; flags are managed through the API.

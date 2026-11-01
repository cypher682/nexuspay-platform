# Reporting Service

**Status: verified live on k3s** (2 pods, Synced/Healthy, `up=1` on both replicas, snapshots and
CSV export exercised end-to-end through the public gateway).

`reporting-service` (:4006) is the read model for payments. It never writes to the payments
database: a second `pg` pool runs time-bounded aggregate queries against `nexuspay_payments`
and materialises one row per UTC day + currency into its own database. Admin users can force a
refresh; a Kubernetes CronJob keeps the last week rolling on its own.

## Data model (`nexuspay_reporting`)

| Object | Purpose |
|---|---|
| `daily_payment_snapshots` | `day` (UTC date), `currency`, succeeded/failed/refunded counts, `grossVolumeMinor` / `refundedVolumeMinor` as `BIGINT`; unique on `(day, currency)` |
| `report_runs` | One row per refresh: `status` (`RUNNING`/`SUCCEEDED`/`FAILED`), `fromDay`, `toDay` (exclusive), `rowsWritten`, `error`, timestamps |

Upserts make refreshes idempotent: re-running a window rewrites the same rows instead of
duplicating them. Volumes stay in minor units (`*Minor`) so no floating point is involved.

## API (gateway-routed, JWT)

| Method & path | Scope | Notes |
|---|---|---|
| `GET /v1/reports/payments/daily` | `reports:read` (or `*`) | `?from=YYYY-MM-DD&to=YYYY-MM-DD&currency=NGN`; `to` exclusive; defaults to the last 30 days |
| `GET /v1/reports/payments/daily.csv` | `reports:read` (or `*`) | same filters, `text/csv` download |
| `GET /v1/reports/runs` | `reports:read` (or `*`) | `?limit` (1–100, default 20), newest first |
| `POST /v1/reports/refresh` | `reports:admin` (or `*`) | body `{from?, to?}`; defaults to the last 7 days; max 366 days; synchronous, returns 202 after the upserts commit |

Auth is verified locally with the shared JWT secret and issuer `NexusPay`; the gateway also
authenticates first, so both layers reject bad tokens. `/health`, `/health/live`,
`/health/ready` and `/metrics` are standard.

## Snapshot job

`src/jobs/snapshot.ts` runs the same `refreshRange` code path with `SNAPSHOT_DAYS` (default 7)
and exits non-zero on failure so Kubernetes retries it. The chart renders a CronJob
`reporting-service-snapshot` at `15 2 * * *` with `concurrencyPolicy: Forbid`, one retry, and
the same restricted security context as the Deployment.

## Aggregation semantics

- Days are bucketed in **UTC** (`date_trunc('day', "createdAt" AT TIME ZONE 'UTC')`).
- `succeededCount` includes `SUCCEEDED` and `REFUNDED` payments (both were charged).
- `refundedCount` and `refundedVolumeMinor` isolate refunds; gross volume still includes them,
  so net = gross − refunded.
- Only windows fully covered by the payments table are stored; days with no payments produce no
  row (the API returns what exists, it does not fabricate zeros).
- Queries run with `statement_timeout = 15s` on the payments pool, so a slow payments query
  fails the run and records `FAILED` instead of pinning the service.

## Deployment

- Chart: `infra/kubernetes/helm/services/reporting-service` (library chart;
  `networkPolicy.mode: gateway-only`, egress to postgres:5432 only via `reporting-egress.yaml`).
- DB: `nexuspay_reporting` on the shared Postgres; secrets `reporting-db` and `payments-db`
  (`url`) in `nexuspay-prod`.
- Migration: PreSync Job with its own hook ServiceAccount against `reporting-db`.
- Metrics: `report_refresh_total{status}`, `report_rows_written_total`, plus standard RED
  metrics labelled `service="reporting-service"`.

## Evidence (verified 2026-11-01)

```console
$ kubectl -n argocd get app nexuspay-reporting-service-prod          # Synced Healthy
$ kubectl -n nexuspay-prod get pods -l app.kubernetes.io/name=reporting-service
reporting-service-56449487f4-kk64c   1/1 Running   # image sha256:ae79696f...
reporting-service-56449487f4-xmlth   1/1 Running

POST /v1/reports/refresh  {"from":"2026-10-25","to":"2026-11-02"}
  -> 202 {"from":"2026-10-25","to":"2026-11-02",
          "runId":"cmvy23l4500049w01ywh0eufp","rowsWritten":3}

GET /v1/reports/payments/daily.csv
  -> 200 day,currency,succeededCount,failedCount,refundedCount,grossVolumeMinor,refundedVolumeMinor
         2026-10-29,NGN,2,0,0,10000,0
         2026-10-31,NGN,2,1,0,20050000,0
         2026-11-01,NGN,2,1,0,20050000,0

POST /v1/reports/refresh  {"from":"2026-11-02","to":"2026-10-25"}   -> 422
  `from` must be before `to`

kubectl -n nexuspay-prod create job reporting-snapshot-manual \
  --from=cronjob/reporting-service-snapshot                           # completed
  log: service="reporting-service" "snapshot job finished" rowsWritten=3

# Prometheus
up{job="reporting-service"}        -> 1 for 10.42.0.143:4006 and 10.42.0.144:4006
sum by (status) (report_refresh_total) -> succeeded 1
sum(report_rows_written_total)     -> 3
# 17/17 api-gateway + *-service targets up
```

## Runbook

- **Backfill a gap:** `POST /v1/reports/refresh` with `from`/`to` (≤366 days); watch
  `GET /v1/reports/runs` for the final `rowsWritten`/`error`.
- **Cron missed:** `kubectl -n nexuspay-prod create job --from=cronjob/reporting-service-snapshot
  reporting-snapshot-manual`; delete the job afterwards so ArgoCD stays green.
- **Stale or wrong day:** re-run the window; upserts overwrite in place.
- **Payments query slow:** check the run's `error` in `report_runs`; the pool aborts at 15s.
- **Scopes:** grant `reports:read` for dashboards/exports, `reports:admin` only for operators.

## Known limits

- Snapshots are **only as fresh as the last refresh**; the API does not compute on demand.
- Refunds are attributed to the day the payment was created, not the refund date (the payments
  table has no refunded-at column yet).
- The daily series is keyed by day + currency; there is no per-provider or per-method breakdown.
- CSV is generated in memory for at most 366 days × currencies — fine at lab scale, not a
  streaming export.
- No retention policy: `report_runs` grows with every refresh (trim manually or add a job).
- No UI; the CSV is meant for spreadsheets/BI, the JSON for dashboards.

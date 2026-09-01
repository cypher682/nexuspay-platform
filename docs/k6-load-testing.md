# k6 Load Testing

Load tests for the NexusPay platform using [k6](https://k6.io). Run them against
the local Docker Compose stack (full load tests) or a subset in CI (smoke).

## Prerequisites

- The stack is running: `docker compose up -d --build`
- k6 is installed (`choco install k6` / `winget install k6` / `brew install k6`)
- `.env` is present and has the load-test rate-limit overrides (see `.env.example`):
  - `AUTH_RATE_LIMIT_MAX_REQUESTS=5000`
  - `RATE_LIMIT_MAX_REQUESTS=5000`
  - `DOWNSTREAM_TIMEOUT_MS=5000`
  - `BCRYPT_ROUNDS=10`
  - `UV_THREADPOOL_SIZE=8`

## Tests

| Script | Stage | Verifies |
|--------|-------|----------|
| `k6/smoke-test.js` | CI (lightweight, 1 VU) | Gateway `/health` returns 200 + status ok |
| `k6/auth-login.js` | Local (2 VU sustained) | Login issues an access token; `/v1/users/me` is reachable |
| `k6/payment-create.js` | Local (3 VU sustained) | Full payment flow: create → get → list, with idempotency keys |

## Running

```bash
# CI-equivalent smoke test
k6 run k6/smoke-test.js

# Full load tests (auth + payments) — see scripts/seed-test-user.ts first
npm run seed:test-user
k6 run k6/auth-login.js
k6 run k6/payment-create.js

# Or use the wrapper which seeds + runs
./k6/run-local.sh all
```

> Auth/payment tests log in as a **pre-seeded, verified** user. Run the seed once
> per fresh database:
> ```bash
> AUTH_DB_URL="postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public" \
>   npm run seed:test-user
> ```
> The seed registers the user and flips `isVerified=true` directly in the auth DB
> (the `/v1/auth/verify-email` endpoint is a 501 stub, so there is no API path to
> verify a user yet).

## Findings from Phase 1 load testing

### 1. Synchronous bcryptjs blocks the Node event loop (real bug)
`bcryptjs.compareSync` (pure JavaScript, no native bindings) with `BCRYPT_ROUNDS=12`
runs **synchronously on the main thread** (~300–500ms per compare). Under concurrent
login load, requests queue behind bcrypt computation and exceed the gateway's
2000ms downstream timeout.

- **Impact:** gateway circuit breaker (threshold 5) opened after ~5 timeouts and
  returned `503 Downstream temporarily unavailable` to *all* subsequent requests
  for 30s — a cascade, not graceful degradation.
- **Fix:**
  - `verifyPassword` → `await bcrypt.compare` (async, yields between rounds).
  - `BCRYPT_ROUNDS=10` in dev/test.
  - `UV_THREADPOOL_SIZE=8` for auth-service.
  - `DOWNSTREAM_TIMEOUT_MS=5000` so load spikes don't prematurely trip the breaker.
- **Remaining limit:** `bcryptjs.compare` still computes on the main loop (unlike
  native `bcrypt` which uses the libuv threadpool). Sustained auth throughput is
  capped around **2 VUs** on a single local worker. To scale: switch to native
  `bcrypt` (adds native build tools to the image) or run multiple auth workers,
  and reduce `BCRYPT_ROUNDS`.

### 2. Gateway missing `/users` proxy (real bug)
`GET /v1/users/me` returned `404 Route not found` through the gateway because
`v1.ts` only proxied `/auth`, `/payments`, `/notifications`. Added
`router.use("/users", authenticate, proxy(AUTH_SERVICE_URL))` — now reachable and
validated by the auth test.

### 3. General rate limit throttled payment creation
The general (non-auth) limiter defaults to `RATE_LIMIT_MAX_REQUESTS=100`/min keyed
by user id. The payment load test (create + get + list per iteration) blew past it
→ `429 Too many requests` on ~70% of creates. Raised to 5000 for load testing;
keep tight in production.

### 4. Postgres host-port conflict (local env)
A native Postgres on the host already occupied `5432`; compose mapped
`5432:5432` so host-side Prisma migrations hit the wrong server
(`authentication failed for nexuspay`). Remapped compose to `5433:5432`; all
in-cluster service URLs still use `postgres:5432` internally.

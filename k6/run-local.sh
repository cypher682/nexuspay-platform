#!/bin/bash
# Run k6 load tests against local Docker Compose stack
# Usage: ./k6/run-local.sh [test-name]
#
# Prerequisites: docker compose up --build, k6 installed
#
# The auth/payment tests log in as a pre-seeded, verified user. Run the seed
# (brought up by "auth", "payment" and "all" below) after a fresh DB:
#   AUTH_DB_URL="postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public" \
#     npm run seed:test-user

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:4000}"
TEST="${1:-smoke}"
AUTH_DB_URL="${AUTH_DB_URL:-postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public}"

echo "🎯 Target: $BASE_URL"
echo "📊 Test: $TEST"
echo ""

# Verify services are up
if ! curl -sf "$BASE_URL/health" > /dev/null 2>&1; then
  echo "❌ Services not reachable at $BASE_URL"
  echo "   Run: docker compose up -d --build"
  exit 1
fi

# Seed a verified load-test user before tests that need authentication.
case "$TEST" in
  auth|payment|all)
    echo "🔑 Seeding verified load-test user..."
    AUTH_DB_URL="$AUTH_DB_URL" BASE_URL="$BASE_URL" npx tsx scripts/seed-test-user.ts || {
      echo "⚠️  Seed failed — auth/payment tests need a verified user (and the restriction"
      echo "   AUTH_RATE_LIMIT_MAX_REQUESTS must be raised for load runs; set it in .env)."
      exit 1
    }
    ;;
esac

case "$TEST" in
  smoke)
    k6 run k6/smoke-test.js
    ;;
  auth)
    k6 run k6/auth-login.js
    ;;
  payment)
    k6 run k6/payment-create.js
    ;;
  all)
    echo "=== Smoke Test ==="
    k6 run k6/smoke-test.js
    echo ""
    echo "=== Auth Login ==="
    k6 run k6/auth-login.js
    echo ""
    echo "=== Payment Create ==="
    k6 run k6/payment-create.js
    ;;
  *)
    echo "Usage: $0 [smoke|auth|payment|all]"
    exit 1
    ;;
esac

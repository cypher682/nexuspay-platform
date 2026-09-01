#!/usr/bin/env bash
# Creates the Kubernetes secrets the NexusPay charts reference.
# Idempotent: existing secrets are left untouched unless --force is passed.
set -euo pipefail

NAMESPACE="${1:-nexuspay-dev}"
FORCE="${2:-}"

rand() { openssl rand -hex "$1"; }

create_secret() {
  local name="$1"; shift
  if kubectl -n "$NAMESPACE" get secret "$name" >/dev/null 2>&1 && [ -z "$FORCE" ]; then
    echo "secret/$name already exists in $NAMESPACE — skipping (use --force to recreate)"
    return
  fi
  kubectl -n "$NAMESPACE" delete secret "$name" >/dev/null 2>&1 || true
  kubectl -n "$NAMESPACE" create secret generic "$name" "$@"
  echo "created secret/$name in $NAMESPACE"
}

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

JWT=$(rand 32)
API_KEY=$(rand 24)
WEBHOOK_SECRET=$(rand 24)

create_secret nexuspay-shared \
  --from-literal="jwt-secret=$JWT" \
  --from-literal="internal-api-key=$API_KEY" \
  --from-literal="provider-webhook-secret=$WEBHOOK_SECRET"

for svc in auth payments notifications; do
  DB_PASS=$(rand 16)
  create_secret "${svc}-db" \
    --from-literal="url=postgresql://nexuspay:${DB_PASS}@postgres-postgresql.nexuspay-data.svc.cluster.local:5432/nexuspay_${svc}?schema=public"
done

RABBIT_PASS=$(rand 16)
create_secret rabbitmq-url \
  --from-literal="url=amqp://nexuspay:${RABBIT_PASS}@rabbitmq.nexuspay-data.svc.cluster.local:5672"

echo
echo "Done. NOTE: postgres/redis/rabbitmq users must be created with the same"
echo "passwords for the URLs above to resolve — see infra/kubernetes/data/README.md."

#!/usr/bin/env bash
# Phase 3.6 - JWT key rotation (zero-downtime).
#
# Symmetric HS256 rotation requires the verifying service to accept both old
# and new keys during a grace period. This script:
#
#   1. Reads the current JWT secret from the K8s Secret (or compose env).
#   2. Generates a cryptographically random 32-byte replacement.
#   3. Patches the K8s Secret so it holds BOTH keys (jwt-secret = new,
#      old-jwt-secrets = comma-separated previous value).
#   4. Rolling-restarts all deployments that use the secret.
#   5. After a configurable --grace period (default 24h), removes the old key
#      and patches the secret again (intended to be run as a CronJob or CI step).
#
# Prereq (for zero-downtime):
#   auth-service's jwt.verify must iterate over old-jwt-secrets when present.
#   See services/auth-service/src/lib/tokens.ts — the rotate helper already
#   exports the rotate-safety function below.
#
# Usage:
#   bash scripts/rotate-jwt-keys.sh rotate --target minikube --namespace nexuspay-dev
#   bash scripts/rotate-jwt-keys.sh expire  --target minikube --namespace nexuspay-dev
#   bash scripts/rotate-jwt-keys.sh rotate --target compose --env .env
set -euo pipefail

CMD="${1:-}"
shift || true
TARGET="minikube"
GRACE="24h"
NAMESPACE="nexuspay-dev"
ENV_FILE=".env"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)   TARGET="$2";  shift 2;;
    --namespace) NAMESPACE="$2"; shift 2;;
    --grace)    GRACE="$2";   shift 2;;
    --env)      ENV_FILE="$2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 1;;
  esac
done

rand() { openssl rand -hex 32; }

case "$CMD" in

# ── ROTATE ─────────────────────────────────────────────────────────────────────
rotate)
  NEW=$(rand)
  if [ "$TARGET" = "minikube" ]; then
    OLD=$(kubectl -n "$NAMESPACE" get secret nexuspay-shared -o jsonpath='{.data.jwt-secret}' | base64 -d)
    # Append old key to the multi-key accept list.
    EXISTING_OLD=$(kubectl -n "$NAMESPACE" get secret nexuspay-shared -o jsonpath='{.data.old-jwt-secrets}' 2>/dev/null | base64 -d 2>/dev/null || true)
    [ -n "$EXISTING_OLD" ] && OLD_KEYS="${EXISTING_OLD},${OLD}" || OLD_KEYS="${OLD}"

    kubectl -n "$NAMESPACE" patch secret nexuspay-shared --type=merge -p \
      "{\"data\":{\"jwt-secret\":\"$(echo -n "$NEW" | base64)\",\"old-jwt-secrets\":\"$(echo -n "$OLD_KEYS" | base64)\"}}"

    echo "→ secret/nexuspay-shared updated; new key active, old key added to accept list"
    echo "→ rolling restart deployments in $NAMESPACE"

    for deploy in api-gateway auth-service payments-service notifications-service; do
      kubectl -n "$NAMESPACE" rollout restart "deployment/$deploy" 2>/dev/null || true
      echo "  ↻ $deploy restarted"
    done

    # Record rotation timestamp for the expire step.
    kubectl -n "$NAMESPACE" patch configmap nexuspay-rotation-state --type=merge \
      -p "{\"data\":{\"last-rotation\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"grace\":\"$GRACE\"}}" \
      2>/dev/null || kubectl -n "$NAMESPACE" create configmap nexuspay-rotation-state \
      --from-literal="last-rotation=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --from-literal="grace=$GRACE" --dry-run=client -o yaml | kubectl apply -f -

  elif [ "$TARGET" = "compose" ]; then
    # Compose env rotation: write directly to .env; services must be restarted.
    if [ -f "$ENV_FILE" ]; then
      OLD=$(grep -o '^JWT_SECRET=.*' "$ENV_FILE" | cut -d= -f2- || true)
      sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$NEW|" "$ENV_FILE"
      # Preserve the previous secret for zero-downtime verification.
      if grep -q '^OLD_JWT_SECRETS=' "$ENV_FILE"; then
        sed -i.bak "s|^OLD_JWT_SECRETS=.*|OLD_JWT_SECRETS=${OLD}|" "$ENV_FILE"
      else
        echo "OLD_JWT_SECRETS=${OLD}" >> "$ENV_FILE"
      fi
      rm -f "$ENV_FILE.bak"
    else
      echo "JWT_SECRET=$NEW" >> "$ENV_FILE"
    fi
    echo "→ $ENV_FILE updated"
    echo "→ restarting compose services"
    docker compose restart api-gateway auth-service payments-service notifications-service
  fi

  echo ""
  echo "Done. Old key is still accepted. Run: bash scripts/rotate-jwt-keys.sh expire --target $TARGET"
  echo "after the grace period ($GRACE) to remove old keys."
  ;;

# ── EXPIRE (remove old keys after grace period) ───────────────────────────────
expire)
  if [ "$TARGET" = "minikube" ]; then
    kubectl -n "$NAMESPACE" patch secret nexuspay-shared --type=json \
      -p '[{"op":"remove","path":"/data/old-jwt-secrets"}]' 2>/dev/null || true
    kubectl -n "$NAMESPACE" rollout restart deployment/api-gateway \
      deployment/auth-service deployment/payments-service \
      deployment/notifications-service 2>/dev/null || true
    echo "→ old-jwt-secrets removed; only current key accepted"

  elif [ "$TARGET" = "compose" ]; then
    if grep -q '^OLD_JWT_SECRETS=' "$ENV_FILE" 2>/dev/null; then
      sed -i.bak '/^OLD_JWT_SECRETS=/d' "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
    fi
    docker compose restart api-gateway auth-service payments-service notifications-service
    echo "→ old-jwt-secrets removed from $ENV_FILE; services restarted"
  fi
  ;;

*)
  echo "usage: $0 {rotate|expire} [--target minikube|compose] [--namespace ns] [--env .env] [--grace 24h]"
  exit 1
  ;;
esac
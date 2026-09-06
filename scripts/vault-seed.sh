#!/bin/bash
# Phase 3.3 - Vault dynamic database credentials.
#
# Bootstraps the HashiCorp Vault dev server (compose: vault, host port 18200)
# and enables the database secrets engine against the local Postgres so
# services can request short-lived, automatically-revoked database users
# instead of sharing a static superuser password.
#
# Uses the vault CLI that ships inside the vault container, so no host
# vault binary is required. Prereq: the compose stack is up. Run from repo root.
set -euo pipefail

VAULT_CONTAINER="${VAULT_CONTAINER:-nexuspay-vault}"
VAULT_TOKEN="${VAULT_TOKEN:-nexuspay-root-token}"
POSTGRES_USER="${POSTGRES_USER:-nexuspay}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-nexuspay}"
VAULT_ADDR_INTERNAL="http://localhost:8200"

vc() { docker exec -e VAULT_ADDR="$VAULT_ADDR_INTERNAL" -e VAULT_TOKEN="$VAULT_TOKEN" "$VAULT_CONTAINER" vault "$@"; }

echo "==> Waiting for Vault container $VAULT_CONTAINER"
for i in $(seq 1 30); do
  if docker exec "$VAULT_CONTAINER" vault status >/dev/null 2>&1; then break; fi
  sleep 1
  if [ "$i" = 30 ]; then echo "Vault container not ready in 30s" >&2; exit 1; fi
done

echo "==> Enabling database secrets engine at database/ (idempotent)"
if ! vc secrets list -format=json | python -c 'import json,sys; sys.exit(0 if "database/" in json.load(sys.stdin) else 1)' 2>/dev/null; then
  vc secrets enable -path=database database
else
  echo "    database/ already enabled - skipping"
fi

echo "==> Configuring the Postgres connection (admin connection, revoke on close)"
vc write database/config/nexuspay \
  plugin_name=postgresql-database-plugin \
  allowed_roles="nexuspay-app" \
  connection_url="postgresql://{{username}}:{{password}}@postgres:5432/nexuspay_auth?sslmode=disable" \
  username="$POSTGRES_USER" \
  password="$POSTGRES_PASSWORD"

echo "==> Creating role 'nexuspay-app' (TTL 60s, max 5m)"
vc write database/roles/nexuspay-app \
  db_name=nexuspay \
  creation_statements="CREATE USER \"{{name}}\" WITH PASSWORD '{{password}}' VALID UNTIL '{{expiration}}'; GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA PUBLIC TO \"{{name}}\";" \
  default_ttl="60s" \
  max_ttl="300s"

echo "==> Verifying the role can mint a credential"
vc read -format=json database/creds/nexuspay-app | python -c '
import json, sys
d = json.load(sys.stdin)
print("    username =", d["data"]["username"])
print("    password = <" + str(len(d["data"]["password"])) + " chars, redacted>")
print("    lease_id =", d["lease_id"])
print("    ttl      =", d["lease_duration"], "s (auto-revoked on expiry)")
'

echo ""
echo "==> Done. Dynamic DB secrets enabled:"
echo "    - UI:      http://localhost:18200/ui - database/creds/nexuspay-app"
echo "    - Mint:    vault read database/creds/nexuspay-app   (TTL 60s)"
echo "    - Revoke:  vault lease revoke database/creds/nexuspay-app"
echo ""
echo "    Services still boot from the static compose credential (POSTGRES_PASSWORD)"
echo "    for startup simplicity; a production deployment would authenticate services"
echo "    against Vault and inject short-lived creds via Vault Agent / ESO."
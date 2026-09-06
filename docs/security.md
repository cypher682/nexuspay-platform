# NexusPay Security Hardening (Phase 3)

A "defense in depth" layer added on top of the observability stack (Phase 2).
Every control here is declarative, version-controlled, and (where the local lab
allows) verified end-to-end.

## 1. Network policies — deny by default

Policy file: `infra/kubernetes/network-policies/`

| File | Purpose |
|------|---------|
| `deny-all.yaml` | Deny all ingress+egress in `nexuspay-dev`, `nexuspay-prod`, `nexuspay-data` (the baseline) |
| `allow-gateway-ingress.yaml` | Gateway accepts from outside the cluster (`ingress`) and anywhere inside |
| `allow-dns-egress.yaml` | All pods can reach kube-dns/core-dns egress :53 |
| `api-gateway-egress.yaml` | Gateway → auth/payments/notifications :4001/:4002/:4003 |
| `auth-egress.yaml` | Auth → postgres :5432 |
| `payments-egress.yaml` | Payments → postgres :5432, redis :6379, rabbitmq :5672 |
| `notifications-egress.yaml` | Notifications → postgres :5432, rabbitmq :5672, mailpit :1025 |
| `data-ingress.yaml` | Postgres/redis/rabbitmq/mailpit accept only the correct app pods |

`deny-all` is applied **after** the app-scoped Helm NetworkPolicies already
rendered by `_workloads.tpl` so that no default-allow window exists.

## 2. Pod Security Admission (restricted)

File: `infra/kubernetes/security/pod-security.yaml`

`nexuspay-dev` and `nexuspay-prod` are labeled with
`pod-security.kubernetes.io/enforce: restricted` (also `audit` + `warn`).
`nexuspay-data` is `baseline`.

The Helm library chart (`_deployment.tpl`) already renders restricted-compliant
workloads (`runAsNonRoot`, `seccompProfile: RuntimeDefault`, `drop: [ALL]`,
`allowPrivilegeEscalation: false`), so enforcement turns the design intent into
something the API server refuses to violate.

## 3. HashiCorp Vault — dynamic database credentials

- Compose service runs Vault 1.17 dev (host `localhost:18200`; 8200 falls in a
  Windows-excluded range).
- `scripts/vault-seed.sh` enables the `database/` engine against Postgres,
  creates role `nexuspay-app` (TTL 60s / max 5m), and mints a credential.
- **Verified live:** a Vault-minted user connected to Postgres successfully,
  and after the 60s TTL the credential was revoked (`password authentication
  failed`) — automatic lease expiry works.

In-cluster scaffold: `infra/kubernetes/vault/vault-dev.yaml` (a scoped,
read-only Vault token via an init Job + policy ConfigMap).

## 4. External Secrets Operator (ESO)

`infra/kubernetes/vault/external-secrets.yaml` + `vault-secrets.yaml`

ESO syncs Vault KV values into native `Secret`s that the service charts already
consume by name (`nexuspay-shared`, `auth-db`, `payments-db`, `notifications-db`,
`rabbitmq-url`). Install the operator (pinned), apply the SecretStore, then
delete the manually-bootstrapped secrets and ESO owns them.

## 5. Zero-downtime JWT key rotation

`scripts/rotate-jwt-keys.sh` (`rotate` / `expire` subcommands, both
`--target minikube` and `--target compose`).

The services now verify tokens against `JWT_SECRET` **and** the comma-separated
`OLD_JWT_SECRETS` list:

- **rotate**: generates a new secret, sets `jwt-secret` to it and appends the
  old secret to `old-jwt-secrets`, then rolling-restarts workloads. Old tokens
  keep working.
- **expire**: after the grace period (default 24h) removes `old-jwt-secrets`.

Unit-tested in `services/auth-service/tests/tokens.rotation.test.ts` (accept
new, accept old, reject unknown). A CronJob + least-privilege RBAC scaffold lives
in `infra/kubernetes/security/rotate-jwt-{cronjob,rbac}.yaml`.

## 6. Image signing (Cosign) + admission verification

- CI (`ci.yml` build job) signs each pushed image with `COSIGN_PRIVATE_KEY` and
  verifies it with the checked-in `cosign.pub`.
- Gatekeeper `K8sRequireImageDigest` constraint rejects any Prod workload image
  not pinned by a `@sha256:` digest (`policies/k8srequireimagedigest-template.yaml`
  + `policies/nexuspay-require-image-digest.yaml`).
- sigstore policy-controller `ClusterImagePolicy` scaffold enforces the actual
  cryptographic signature at admission (`policies/signed-images.yaml`).

To activate signing (one-time), see the note in `docs/lab-roadmap.md`.

## Summary of files

```
infra/kubernetes/network-policies/   # 8 files, deny-all + explicit flows
infra/kubernetes/security/           # pod-security.yaml + jwt-rotation (cronjob/rbac)
infra/kubernetes/vault/              # vault-dev.yaml, external-secrets.yaml, vault-secrets.yaml
infra/kubernetes/policies/           # gatekeeper (allow-repos/required-res) + image digests + signed-images
scripts/vault-seed.sh                # dynamic DB creds (verified)
scripts/rotate-jwt-keys.sh           # zero-downtime key rotation
services/*/src/config/env.ts        # +OLD_JWT_SECRETS
services/*/src/lib/tokens.ts        # multi-key verify
services/auth-service/tests/tokens.rotation.test.ts
```
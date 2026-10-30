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
| `auth-egress.yaml` | Auth → postgres :5432, rabbitmq :5672 (verification/reset events) |
| `payments-egress.yaml` | Payments → postgres :5432, redis :6379, rabbitmq :5672 |
| `notifications-egress.yaml` | Notifications → postgres :5432, rabbitmq :5672, mailpit :1025 |
| `data-ingress.yaml` | Postgres/redis/rabbitmq/mailpit accept only the correct app pods |

`deny-all` is applied **after** the app-scoped Helm NetworkPolicies already
rendered by `_workloads.tpl` so that no default-allow window exists.

### What is enforced on k3s (verified 2026-10-29)

Applied to `nexuspay-prod` and `nexuspay-data` (there is no `nexuspay-dev`
namespace on the cluster; its documents in the same files are inert):

- `deny-all` + per-service egress + data-store ingress, on top of the
  Helm-rendered per-service policies (gateway `open`, internal services
  `gateway-only`).
- `notifications-service` had `networkPolicy.enabled: false`; once deny-all was
  in place its pods had no ingress allow, and the gateway returned
  `502 Downstream unavailable`. Enabled in `values.yaml` and re-verified.

Full path exercised through Traefik on the public URL:

| Check | Result |
|---|---|
| `/health/live`, `/health/ready` | 200 / 200 |
| register 201 → verify-email 200 (token from Mailpit) → login 200 → `/v1/users/me` 200 | pass |
| payment 201 → `SUCCEEDED` (`mock_...`) → receipt notification `SENT` | pass |
| gateway → notifications :4003 | allowed |
| gateway → postgres :5432, payments → notifications :4003, gateway → `1.1.1.1` | refused |

`nexuspay-data` also gets the Bitnami charts' own policies; NetworkPolicies are
additive, so the union is what applies. The files are reconciled by the
`nexuspay-platform-netpol` ArgoCD app.

Observability exception (added 2026-10-30): Prometheus lives in the
`monitoring` namespace and scrapes the app pods directly, which deny-all would
otherwise block. `allow-metrics-ingress` opens TCP 4000-4003 to pods labelled
`app.kubernetes.io/name` in {api-gateway, auth-service, payments-service,
notifications-service} from `monitoring` only. Mailpit's ingress now also
accepts SMTP from `monitoring` so Alertmanager can deliver. No other inbound
path into the app namespaces was added.

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

## 6. Admission control — Gatekeeper (live)

Installed `gatekeeper/gatekeeper` 3.23.1 via Helm (ns `gatekeeper-system`, one
controller and one audit replica). `enableK8sNativeValidation` is off: with the
chart default the constraints were pointed at a `vap.k8s.io` enforcement point
that this k3s build does not serve, and constraint status reported
`K8sNativeValidation engine is missing` while everything was admitted.

```bash
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
helm upgrade --install gatekeeper gatekeeper/gatekeeper -n gatekeeper-system --create-namespace \
  --set replicas=1 --set audit.replicas=1 --set enableK8sNativeValidation=false
# templates + constraints only; signed-images.yaml needs policy-controller
kubectl apply -f infra/kubernetes/policies/k8srequireimagedigest-template.yaml \
  -f infra/kubernetes/policies/k8sallowedrepos-template.yaml \
  -f infra/kubernetes/policies/k8srequiredresources-template.yaml \
  -f infra/kubernetes/policies/nexuspay-require-image-digest.yaml \
  -f infra/kubernetes/policies/nexuspay-allowed-repos.yaml \
  -f infra/kubernetes/policies/nexuspay-required-resources.yaml
```

Templates and constraints live in `infra/kubernetes/policies/` and are scoped to
`nexuspay-prod` Deployments/StatefulSets (init containers included):

| Template | Constraint | Denies |
|---|---|---|
| `K8sRequireImageDigest` | `nexuspay-prod-image-digest-pinned` | image not `@sha256:`-pinned |
| `K8sAllowedRepos` | `nexuspay-prod-approved-registries` | image outside `ghcr.io/cypher682/nexuspay-*` |
| `K8sRequiredResources` | `nexuspay-prod-needs-limits` | container without requests **and** limits |

All four service images are pinned by digest in `values-prod.yaml`;
`_deployment.tpl` and `_migration.tpl` render `repo@digest` when `image.digest`
is set, so the PreSync migration Job obeys the same policy.

A bug caught during verification: the first revision of the rego read
`spec.containers`, which only exists on Pods. Constraints match Deployments, so
the rules saw zero containers and admitted everything — including
`nginx:latest`. The templates now read `spec.template.spec.containers` as well
as the Pod form, and the denial path was re-tested:

| Request | Result |
|---|---|
| `nginx:latest` Deployment | denied by all three constraints |
| digest-pinned image + requests/limits | admitted |
| digest-pinned image, no resources | denied by `needs-limits` |

Templates and constraints are reconciled by the `nexuspay-platform-policies`
ArgoCD app (templates on sync-wave -1). Deleting a constraint and watching
self-heal put it back was the acceptance check.

## 7. Image signing (Cosign) — scaffold, not active

- CI signs each pushed image with `COSIGN_PRIVATE_KEY` and verifies it with the
  checked-in `cosign.pub` once that secret is configured.
- `policies/signed-images.yaml` (`ClusterImagePolicy`) is not applied: it needs
  sigstore policy-controller, which is not installed on this cluster.
- The Gatekeeper digest constraint is the admission control that actually runs.

## 8. RBAC posture (audited)

- Each service has its own ServiceAccount with
  `automountServiceAccountToken: false`; the `default` ServiceAccount in both
  app and data namespaces was patched the same way.
- No Role or RoleBinding exists in `nexuspay-prod`, and no ClusterRoleBinding
  names a NexusPay service account. `kubectl auth can-i --list` for the app
  identities returns only the built-in discovery verbs.
- Accepted exception: the Bitnami rabbitmq chart mounts a token and binds
  `rabbitmq-endpoint-reader` for peer discovery; it can read Endpoints only.
- Mailpit also runs without a token; its manifest is now versioned at
  `infra/kubernetes/data/mailpit.yaml` with the image pinned by digest.

## Summary of files

```
infra/kubernetes/network-policies/   # deny-all + explicit flows (prod/data applied)
infra/kubernetes/monitoring/         # kube-prometheus-stack values + RED dashboard (ArgoCD)
infra/kubernetes/alerts/             # SLO recording + alerting rules (ArgoCD)
infra/kubernetes/data/mailpit.yaml   # SMTP sink, digest-pinned, no SA token
infra/kubernetes/security/           # pod-security.yaml + jwt-rotation (cronjob/rbac)
infra/kubernetes/vault/              # vault-dev.yaml, external-secrets.yaml, vault-secrets.yaml
infra/kubernetes/policies/           # gatekeeper templates/constraints (digest, repos, limits)
scripts/vault-seed.sh                # dynamic DB creds (verified)
scripts/rotate-jwt-keys.sh           # zero-downtime key rotation
services/*/src/config/env.ts        # +OLD_JWT_SECRETS
services/*/src/lib/tokens.ts        # multi-key verify
services/auth-service/tests/tokens.rotation.test.ts
```

## 9. Still open

- Gatekeeper itself is an imperative cluster add-on (like cert-manager). Its
  templates, constraints and the NetworkPolicies are reconciled by two ArgoCD
  apps, `nexuspay-platform-policies` and `nexuspay-platform-netpol`; a deleted
  constraint was recreated by self-heal as a check.
- No WAF / ingress-level rate limiting yet (Traefik owns 80/443; adding
  ingress-nginx means migrating the ingress class first).
- Cosign signing and policy-controller verification remain inactive.
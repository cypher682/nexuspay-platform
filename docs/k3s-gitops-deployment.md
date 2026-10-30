# NexusPay on single-node k3s with ArgoCD

How the platform runs live on one Oracle Cloud ARM instance, deployed by GitOps rather than
by SSH. The Compose + Caddy path in `deploy/` remains the documented fallback.

## Architecture

```
Internet
   |
   v
Traefik (k3s ServiceLB, ports 80/443)
   |  Ingress: nexuspay.<ip>.sslip.io  (TLS via cert-manager / Let's Encrypt)
   v
api-gateway (3)  --->  auth-service (3)  --->  postgres-postgresql (nexuspay_auth)
   |                   payments-service (3) -->  postgres-postgresql (nexuspay_payments)
   |                   notifications-service -->  postgres-postgresql (nexuspay_notifications)
   |                                              redis-master
   |                                              rabbitmq (events)
   |                                              mailpit (SMTP, UI :8025)
   v
Redis (rate limiting, idempotency, token families)
```

- Cluster: k3s `v1.36.5+k3s1`, node `oracle-instance`, 8 vCPU / 27 GiB, Oracle Linux 9.8 aarch64.
- Namespaces: `nexuspay-prod` (PSA `restricted`), `nexuspay-data` (PSA `baseline`), `argocd`.
- Images: `linux/arm64`, published to GHCR by `.github/workflows/publish.yml` on every green CI run.
- Delivery: ArgoCD `ApplicationSet` watches `infra/kubernetes/helm/services/*` on `main`.
  Prod overlay only — a single node has no room for a parallel dev environment.

## Prerequisites on the box

| Component | Version | Notes |
|---|---|---|
| k3s | v1.36.5+k3s1 | ships Traefik (ServiceLB), local-path storage, metrics-server |
| cert-manager | v1.21.3 | `ClusterIssuer/letsencrypt` (HTTP-01) |
| ArgoCD | v3.5.6 | `argocd` namespace, only the default AppProject before this run |
| helm | v3.22.1 | used only for the data layer and local chart rendering |

Firewall: `firewalld` must trust the pod/service CIDRs (`10.42.0.0/16`, `10.43.0.0/16`) so the
API server and kubelet traffic work with SELinux enforcing.

## 1. Publish images

`.github/workflows/publish.yml` runs on `workflow_run` after CI succeeds:

```yaml
platforms: linux/arm64
tags: ghcr.io/cypher682/nexuspay-<service>:${TAG}, :latest
```

The four packages must be pullable by the node. They are public; anonymous
`GET /v2/cypher682/nexuspay-api-gateway/manifests/latest` returns `200`. If a package is ever
made private, add an `imagePullSecret` to the service accounts instead of hard-coding creds.

## 2. Namespaces, secrets, data layer

```bash
kubectl create ns nexuspay-prod
kubectl label ns nexuspay-prod \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted

kubectl create ns nexuspay-data
kubectl label ns nexuspay-data pod-security.kubernetes.io/enforce=baseline
```

Secrets in `nexuspay-prod` (values are generated on the box, never committed):

| Secret | Keys |
|---|---|
| `nexuspay-shared` | `jwt-secret`, `old-jwt-secrets`, `internal-api-key`, `provider-webhook-secret` |
| `auth-db`, `payments-db`, `notifications-db` | `url` |
| `rabbitmq-url` | `url` |

`infra/kubernetes/scripts/bootstrap-secrets.sh` is the reference for the shapes.

Data layer (Bitnami charts in `nexuspay-data`):

```bash
helm upgrade --install postgres bitnami/postgresql -n nexuspay-data \
  -f pg-values.yaml            # auth.username/password, database=nexuspay_auth,
                               # primary.initdb.scripts creates payments + notifications DBs
helm upgrade --install rabbitmq bitnami/rabbitmq -n nexuspay-data \
  -f rmq-values.yaml \
  --set image.repository=bitnamilegacy/rabbitmq \
  --set global.security.allowInsecureImages=true
helm upgrade --install redis bitnami/redis -n nexuspay-data \
  --set architecture=standalone --set auth.enabled=false
```

Two gotchas found the hard way:

- Bitnami retired the old Docker Hub tags (`bitnami/rabbitmq:4.1.3-...` now 404s). Point the
  chart at `bitnamilegacy/rabbitmq` and set `global.security.allowInsecureImages=true`.
- The Mailpit chart repo was unreachable from the box, so Mailpit runs as a small raw
  Deployment + Service named `mailpit` on `1025` (SMTP) and `8025` (UI).

## 3. ArgoCD

```bash
kubectl apply -f infra/kubernetes/argocd/project.yaml
kubectl apply -f infra/kubernetes/argocd/applicationset.yaml
```

The ApplicationSet uses a matrix generator: every directory under
`helm/services/*` × the single `prod` element. Charts depend on the local library chart
(`file://../../nexuspay-lib`); ArgoCD resolves it inside its clone, so `charts/` stays
git-ignored and there is one source of truth.

The prod overlay sets `ghcr.io/cypher682/nexuspay-<service>:latest`, and the gateway overlay
adds the Ingress (class `traefik`, annotation `cert-manager.io/cluster-issuer: letsencrypt`,
TLS secret `nexuspay-tls`).

## 4. Migrations

There is no separate migration pipeline. Each DB-backed chart renders a Helm
`pre-install,pre-upgrade` hook that runs `npx --no-install prisma migrate deploy` with the
service image. ArgoCD maps those to a **PreSync** phase, so the schema is applied before the
Deployment rolls out, and `hook-succeeded` deletes the Job afterwards so it does not linger in
the app tree.

`prisma migrate deploy` is idempotent, so every sync is safe.

## 5. Verification

```console
$ kubectl -n argocd get applications
NAME                                  SYNC STATUS   HEALTH STATUS
nexuspay-api-gateway-prod             Synced        Healthy
nexuspay-auth-service-prod            Synced        Healthy
nexuspay-notifications-service-prod   Synced        Healthy
nexuspay-payments-service-prod        Synced        Healthy

$ kubectl -n nexuspay-prod get deploy
NAME                    READY   UP-TO-DATE   AVAILABLE
api-gateway             3/3     3            3
auth-service            3/3     3            3
notifications-service   2/2     2            2
payments-service        3/3     3            3
```

Public smoke test:

```console
$ curl -s -o /dev/null -w '%{http_code}\n' https://nexuspay.<ip>.sslip.io/health/ready
200

$ curl -s https://nexuspay.<ip>.sslip.io/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"Secure1234!","fullName":"Alice Johnson"}'
{"user":{...,"isVerified":false},"accessToken":"..."}

$ curl -s https://nexuspay.<ip>.sslip.io/v1/payments \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -H "Idempotency-Key: demo-1" \
  -d '{"amountMinor":5000,"currency":"NGN","provider":"MOCK_CARD"}'
{"status":"PENDING",...}
```

Then the payment settles asynchronously (`status: SUCCEEDED`, `providerRef: mock_...`), the
`payment_receipt_email` notification is recorded as `SENT`, and the email lands in Mailpit.
`GET /v1/me/summary` fans out to auth + payments and returns both under one request id.

Certificate: `Certificate/nexuspay-tls` reports `Ready=True`, issuer
`Let's Encrypt CN=YR1`, valid for the sslip.io hostname.

## 6. Observability (Prometheus + Grafana + Alertmanager)

Installed as a cluster add-on with Helm, like cert-manager and ArgoCD. The
values live in the repo:

```bash
kubectl create namespace monitoring
kubectl -n monitoring create secret generic grafana-admin \
  --from-literal=admin-user=admin \
  --from-literal=admin-password="$(openssl rand -base64 18)"
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -n monitoring --version 92.16.1 \
  -f infra/kubernetes/monitoring/kube-prometheus-stack-values.yaml
```

Deliberately trimmed: 7 days / 8 GiB retention on a 10 GiB `local-path` volume,
kube-prometheus-stack's bundled alert rules disabled (only the NexusPay rules
run), Alertmanager routed to Mailpit (`mailpit.nexuspay-data:1025`), and
Prometheus/Grafana/Alertmanager kept ClusterIP-only — no new public surface and
Traefik is untouched.

The four `ServiceMonitor`s are rendered by the Helm library chart
(`serviceMonitor.enabled: true`). The SLO `PrometheusRule` and the NexusPay RED
dashboard are delivered as ArgoCD apps (`nexuspay-platform-alerts`,
`nexuspay-platform-dashboards`). `allow-metrics-ingress` is the only
NetworkPolicy exception that lets the `monitoring` namespace scrape the app
pods, and Mailpit's ingress allows SMTP from `monitoring` for Alertmanager.

Verified 2026-10-30:

```console
$ kubectl -n nexuspay-prod get servicemonitor
NAME                    AGE
api-gateway             2m
auth-service            2m
notifications-service   2m
payments-service        2m

# Prometheus: all 11 prod pods up=1
# 3 api-gateway, 3 auth-service, 3 payments-service, 2 notifications-service
# rule groups: nexuspay-sli-recording-rules (5) + nexuspay-alerting-rules (6)
# p99 recording series: api-gateway=0.00495s, others ~0.02s (4 services)

$ kubectl -n monitoring get pods
NAME                                                          READY   STATUS
alertmanager-kube-prometheus-stack-alertmanager-0             2/2     Running
kube-prometheus-stack-grafana-...                             3/3     Running
kube-prometheus-stack-kube-state-metrics-...                  1/1     Running
kube-prometheus-stack-operator-...                            1/1     Running
kube-prometheus-stack-prometheus-node-exporter-...            1/1     Running
prometheus-kube-prometheus-stack-prometheus-0                 2/2     Running
```

Grafana exposes 29 stock dashboards plus `NexusPay - RED metrics` (request rate,
5xx ratio, p99, scrape targets) against the provisioned Prometheus datasource.
Alerting round-trip: an injected `NexusPaySmokeTest` alert via `amtool` was
delivered to Mailpit as `[FIRING:1] NexusPaySmokeTest -> alerts@nexuspay.local`,
and a real `NexusPayTargetDown` fired and resolved while the metrics
NetworkPolicy was being fixed.

Access (never public):

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090
kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093:9093
```

The Grafana admin password is stored on the box in
`~/.nexuspay-observability.env` (mode 600) and in the `grafana-admin` secret.

## Rollback

The deploy artifact is the git commit. Reverting a commit and pushing is the rollback:

```bash
git revert <sha> && git push
```

ArgoCD auto-syncs within its poll interval (or trigger it immediately by patching
`application.operation.sync`). There is no SSH deploy path to keep in sync.

## Known limitations

- **Single node.** No HA, no node drain story, no control-plane redundancy. The overlay is
  prod-shaped but not prod-grade.
- **Images are digest-pinned and enforced.** Gatekeeper rejects mutable tags and missing
  resource limits in `nexuspay-prod`; ArgoCD diffs real digests.
- **Co-tenancy.** Other projects on the box own port 80/443 through their own reverse proxy;
  Traefik only owns them once that proxy is stopped. Plan a path-based or host-based migration
  before adding more public services.
- **Disk.** 84 GB ephemeral storage; local-path volumes are not backed up. Postgres and
  RabbitMQ PVCs live on the node, as does the 10 GiB Prometheus volume.
- **Observability is metrics + alerting only on k3s.** Prometheus, Grafana and Alertmanager
  are live; the OpenTelemetry SDK is wired in every service but tracing is disabled and no
  Jaeger/Loki backend runs on the cluster. Single Prometheus, no HA or remote write; UIs are
  reachable only through `kubectl port-forward`.

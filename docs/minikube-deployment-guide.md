# NexusPay Platform — Minikube Deployment Guide

> **Target OS:** Windows (Git Bash / PowerShell)  
> **User:** Suleiman  
> **Project path:** `C:\Users\Suleiman\Desktop\Clouddevops-portfolio\F1\nexuspay-platform`  
> **Date:** August 2026

This guide walks you through deploying the complete NexusPay platform locally using Minikube. By the end you will have all four services, the database layer, cache, message broker, and ingress running inside a single Kubernetes cluster.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Docker Image Management](#2-docker-image-management)
3. [Start Minikube](#3-start-minikube)
4. [Enable Addons](#4-enable-addons)
5. [Load Images into Minikube](#5-load-images-into-minikube)
6. [Install Infrastructure Services](#6-install-infrastructure-services)
7. [Create Namespaces and Secrets](#7-create-namespaces-and-secrets)
8. [Deploy NexusPay Services via Helm](#8-deploy-nexuspay-services-via-helm)
9. [Apply Prisma Migrations](#9-apply-prisma-migrations)
10. [Verify All Pods Are Running](#10-verify-all-pods-are-running)
11. [Access Services via Port-Forward](#11-access-services-via-port-forward)
12. [Smoke Test](#12-smoke-test)
13. [Deploying to Other Environments](#13-deploying-to-other-environments)
14. [Optional — Install ArgoCD for GitOps](#14-optional--install-argocd-for-gitops)
15. [Cleanup](#15-cleanup)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Prerequisites

Install the following tools before proceeding.

### Minikube

```bash
# Via Chocolatey
choco install minikube

# Verify
minikube version
```

### kubectl

```bash
# Via Chocolatey
choco install kubernetes-cli

# Verify
kubectl version --client
```

### Helm 3

```bash
# Via Chocolatey
choco install kubernetes-helm

# Verify
helm version
```

### Docker Desktop

Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) with WSL 2 backend enabled. Verify:

```bash
docker info
```

> **Note:** All commands in this guide are designed for **Git Bash**. If you use PowerShell, replace `\` with `` ` `` or use `.\` where appropriate. Paths in Git Bash use `/c/Users/...` format.

---

## 2. Docker Image Management

Your NexusPay Docker images are already built and persist on your machine. They survive `docker compose down` and system restarts. You only lose them if you run `docker image prune`, `docker system prune`, or manually `docker rmi` them.

### Check existing images

```bash
docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}" | grep nexuspay
```

Expected output:

| Image | Size |
|-------|------|
| nexuspay-platform-auth-service:latest | ~610MB |
| nexuspay-platform-payments-service:latest | ~623MB |
| nexuspay-platform-notifications-service:latest | ~609MB |
| nexuspay-platform-api-gateway:latest | ~214MB |

### Rebuild if needed

If you modify source code, rebuild only the changed services:

```bash
cd /c/Users/Suleiman/Desktop/Clouddevops-portfolio/F1/nexuspay-platform

# Rebuild all
docker compose build

# Rebuild a specific service
docker compose build auth-service

# Full rebuild without cache (slower, clean slate)
docker compose build --no-cache
```

With BuildKit cache mounts enabled in the Dockerfiles, subsequent rebuilds after the first one are fast (~30s) since npm caches are preserved.

### Why images are large

Node.js + Prisma images are larger than typical Python images because:
- `node:20-alpine` base is ~180MB
- Prisma bundles a native query engine binary (~40-80MB per service)
- Production `node_modules` with Express, ioredis, etc. adds ~200-300MB

This is normal for Node.js microservices. For a portfolio project, image size is not a concern. For production, you would use a CI/CD pipeline to build once and push to a container registry.

---

## 3. Start Minikube

Start a cluster with enough resources to run the full stack:

```bash
minikube start \
  --driver=docker \
  --cpus=4 \
  --memory=8192 \
  --disk-size=40g \
  --kubernetes-version=v1.30.0
```

Wait for the node to become ready:

```bash
kubectl get nodes
```

Expected output — the node should show `STATUS: Ready`.

---

## 4. Enable Addons

Enable the required addons:

```bash
minikube addons enable ingress
minikube addons enable metrics-server
```

Verify addons are active:

```bash
minikube addons list
```

Both `ingress` and `metrics-server` should show `enabled`.

---

## 5. Load Images into Minikube

Minikube runs its own Docker daemon separate from Docker Desktop. Images built with Docker Desktop are **not** automatically available inside Minikube. You must load them explicitly.

### Load all four images

```bash
cd /c/Users/Suleiman/Desktop/Clouddevops-portfolio/F1/nexuspay-platform

minikube image load nexuspay-platform-auth-service:latest
minikube image load nexuspay-platform-payments-service:latest
minikube image load nexuspay-platform-notifications-service:latest
minikube image load nexuspay-platform-api-gateway:latest
```

> **Note:** Each `minikube image load` takes 30-60 seconds depending on image size. The images are copied into the Minikube VM's Docker daemon.

### Verify images are available inside Minikube

```bash
minikube ssh docker images --format "{{.Repository}}:{{.Tag}}" | grep nexuspay
```

All four images should appear.

### Alternative: Use Minikube's Docker daemon directly

Instead of loading images, you can build directly inside Minikube's Docker daemon:

```bash
# Point your shell to Minikube's Docker daemon
eval $(minikube docker-env)

# Now docker build commands target Minikube directly
docker compose build

# When done, switch back to your local Docker daemon
eval $(minikube docker-env -u)
```

> **Warning:** Images built this way are lost when Minikube stops. Use `minikube image load` for persistence.

---

## 6. Install Infrastructure Services

All infrastructure is installed into the `infrastructure` namespace.

### 4.1 Create the namespace

```bash
kubectl create namespace infrastructure
```

### 4.2 Add Bitnami Helm repo

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### 4.3 PostgreSQL 16

PostgreSQL must host three databases: `nexuspay_auth`, `nexuspay_payments`, and `nexuspay_notifications`.

```bash
helm install postgresql bitnami/postgresql \
  --namespace infrastructure \
  --set auth.postgresPassword=nexuspay_root_2026 \
  --set auth.username=nexuspay \
  --set auth.password=nexuspay_pass_2026 \
  --set primary.persistence.size=8Gi \
  --set image.tag=16.4.0 \
  --wait --timeout 300s
```

Create the three databases after the pod is ready:

```bash
kubectl wait --namespace infrastructure \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=postgresql \
  --timeout=300s

kubectl exec -it -n infrastructure \
  $(kubectl get pods -n infrastructure -l app.kubernetes.io/name=postgresql -o jsonpath='{.items[0].metadata.name}') \
  -- psql -U nexuspay -d nexuspay -c \
  "CREATE DATABASE nexuspay_auth;
   CREATE DATABASE nexuspay_payments;
   CREATE DATABASE nexuspay_notifications;"
```

### 4.4 Redis 7

```bash
helm install redis bitnami/redis \
  --namespace infrastructure \
  --set auth.enabled=false \
  --set master.persistence.size=2Gi \
  --set image.tag=7.2 \
  --wait --timeout 180s
```

### 4.5 RabbitMQ 3.13 with Management Plugin

```bash
helm install rabbitmq bitnami/rabbitmq \
  --namespace infrastructure \
  --set auth.username=nexuspay \
  --set auth.password=nexuspay_mq_2026 \
  --set auth.erlangCookie=nexuspay_erlang_cookie_secret \
  --set plugins="rabbitmq_management rabbitmq_delayed_message_exchange" \
  --set service.ports.amqp=5672 \
  --set service.ports.manager=15672 \
  --set persistence.size=4Gi \
  --set image.tag=3.13 \
  --wait --timeout 300s
```

### 4.6 Verify infrastructure pods

```bash
kubectl get pods -n infrastructure
```

All pods (`postgresql-0`, `redis-master-0`, `rabbitmq-0`) should show `Running`.

---

## 5. Create Namespaces and Secrets

### 5.1 Create the application namespace

```bash
kubectl create namespace nexuspay
```

### 5.2 Bootstrap secrets

Run the existing bootstrap script with the infrastructure connection details:

```bash
cd /c/Users/Suleiman/Desktop/Clouddevops-portfolio/F1/nexuspay-platform

# Make the script executable (Git Bash)
chmod +x scripts/bootstrap-secrets.sh

# Export required values before running
export POSTGRES_HOST=postgresql.infrastructure.svc.cluster.local
export POSTGRES_PORT=5432
export POSTGRES_USER=nexuspay
export POSTGRES_PASSWORD=nexuspay_pass_2026
export REDIS_HOST=redis-master.infrastructure.svc.cluster.local
export REDIS_PORT=6379
export RABBITMQ_HOST=rabbitmq.infrastructure.svc.cluster.local
export RABBITMQ_PORT=5672
export RABBITMQ_USER=nexuspay
export RABBITMQ_PASSWORD=nexuspay_mq_2026
export INTERNAL_API_KEY=nexuspay-internal-dev-key-2026
export PROVIDER_WEBHOOK_SECRET=nexuspay-webhook-dev-secret-2026

./scripts/bootstrap-secrets.sh
```

If the bootstrap script does not accept the env vars above, create the secrets manually:

```bash
# Auth service secrets
kubectl create secret generic auth-service-secrets \
  --namespace nexuspay \
  --from-literal=DATABASE_URL="postgresql://nexuspay:nexuspay_pass_2026@postgresql.infrastructure.svc.cluster.local:5432/nexuspay_auth" \
  --from-literal=REDIS_URL="redis://redis-master.infrastructure.svc.cluster.local:6379" \
  --from-literal=INTERNAL_API_KEY="nexuspay-internal-dev-key-2026" \
  --from-literal=JWT_SECRET="nexuspay-jwt-dev-secret-change-in-prod" \
  --from-literal=JWT_REFRESH_SECRET="nexuspay-jwt-refresh-dev-secret-change-in-prod"

# Payments service secrets
kubectl create secret generic payments-service-secrets \
  --namespace nexuspay \
  --from-literal=DATABASE_URL="postgresql://nexuspay:nexuspay_pass_2026@postgresql.infrastructure.svc.cluster.local:5432/nexuspay_payments" \
  --from-literal=REDIS_URL="redis://redis-master.infrastructure.svc.cluster.local:6379" \
  --from-literal=INTERNAL_API_KEY="nexuspay-internal-dev-key-2026" \
  --from-literal=PROVIDER_WEBHOOK_SECRET="nexuspay-webhook-dev-secret-2026"

# Notifications service secrets
kubectl create secret generic notifications-service-secrets \
  --namespace nexuspay \
  --from-literal=DATABASE_URL="postgresql://nexuspay:nexuspay_pass_2026@postgresql.infrastructure.svc.cluster.local:5432/nexuspay_notifications" \
  --from-literal=REDIS_URL="redis://redis-master.infrastructure.svc.cluster.local:6379" \
  --from-literal=INTERNAL_API_KEY="nexuspay-internal-dev-key-2026" \
  --from-literal=RABBITMQ_URL="amqp://nexuspay:nexuspay_mq_2026@rabbitmq.infrastructure.svc.cluster.local:5672"

# API gateway secrets
kubectl create secret generic api-gateway-secrets \
  --namespace nexuspay \
  --from-literal=INTERNAL_API_KEY="nexuspay-internal-dev-key-2026"
```

---

## 6. Deploy NexusPay Services via Helm

All service charts are located under `infra/kubernetes/helm/`. The library chart (`nexuspay-lib`) must be packaged and available locally before dependent charts can install.

### 6.1 Package the library chart

```bash
cd /c/Users/Suleiman/Desktop/Clouddevops-portfolio/F1/nexuspay-platform

helm package infra/kubernetes/helm/nexuspay-lib
```

This creates a `.tgz` file in the current directory. Helm dependency update will pick it up automatically.

### 6.2 Update Helm dependencies for each service

```bash
helm dependency update infra/kubernetes/helm/auth-service
helm dependency update infra/kubernetes/helm/payments-service
helm dependency update infra/kubernetes/helm/notifications-service
helm dependency update infra/kubernetes/helm/api-gateway
```

### 6.3 Deploy each service with dev values

Deploy **auth-service** first (no dependency on other services):

```bash
helm install auth-service infra/kubernetes/helm/auth-service \
  --namespace nexuspay \
  -f infra/kubernetes/helm/auth-service/values-dev.yaml \
  --wait --timeout 300s
```

Deploy **payments-service**:

```bash
helm install payments-service infra/kubernetes/helm/payments-service \
  --namespace nexuspay \
  -f infra/kubernetes/helm/payments-service/values-dev.yaml \
  --wait --timeout 300s
```

Deploy **notifications-service** (depends on RabbitMQ being fully ready):

```bash
helm install notifications-service infra/kubernetes/helm/notifications-service \
  --namespace nexuspay \
  -f infra/kubernetes/helm/notifications-service/values-dev.yaml \
  --wait --timeout 300s
```

Deploy **api-gateway**:

```bash
helm install api-gateway infra/kubernetes/helm/api-gateway \
  --namespace nexuspay \
  -f infra/kubernetes/helm/api-gateway/values-dev.yaml \
  --wait --timeout 300s
```

### 6.4 Verify Helm releases

```bash
helm list -n nexuspay
```

All four releases should show `STATUS: deployed`.

---

## 7. Apply Prisma Migrations

The services use Prisma with PostgreSQL. The database tables must exist before the application pods can handle requests. Apply migrations by exec-ing into each service pod.

### 7.1 Auth-service migrations

The auth database needs tables: `users`, `roles`, `refresh_tokens`.

```bash
AUTH_POD=$(kubectl get pods -n nexuspay -l app.kubernetes.io/name=auth-service -o jsonpath='{.items[0].metadata.name}')

kubectl exec -it -n nexuspay $AUTH_POD -- npx prisma migrate deploy
```

### 7.2 Payments-service migrations

The payments database needs the `idempotencyRecord` table among others.

```bash
PAYMENTS_POD=$(kubectl get pods -n nexuspay -l app.kubernetes.io/name=payments-service -o jsonpath='{.items[0].metadata.name}')

kubectl exec -it -n nexuspay $PAYMENTS_POD -- npx prisma migrate deploy
```

### 7.3 Notifications-service migrations

```bash
NOTIFICATIONS_POD=$(kubectl get pods -n nexuspay -l app.kubernetes.io/name=notifications-service -o jsonpath='{.items[0].metadata.name}')

kubectl exec -it -n nexuspay $NOTIFICATIONS_POD -- npx prisma migrate deploy
```

### 7.4 Verify migrations succeeded

```bash
# Check auth tables
kubectl exec -it -n nexuspay $AUTH_POD -- \
  psql "$DATABASE_URL" -c "\dt"

# Check payments tables (idempotencyRecord should be present)
kubectl exec -it -n nexuspay $PAYMENTS_POD -- \
  psql "$DATABASE_URL" -c "\dt"

# Check notifications tables
kubectl exec -it -n nexuspay $NOTIFICATIONS_POD -- \
  psql "$DATABASE_URL" -c "\dt"
```

> **Tip:** If `psql` is not available inside the pod, connect from outside by port-forwarding PostgreSQL and running the queries from your host.

---

## 8. Verify All Pods Are Running

### 8.1 Infrastructure pods

```bash
kubectl get pods -n infrastructure
```

Expected:

| Pod | Status |
|-----|--------|
| postgresql-0 | Running |
| redis-master-0 | Running |
| rabbitmq-0 | Running |

### 8.2 Application pods

```bash
kubectl get pods -n nexuspay
```

Expected (one pod per service, name will vary):

| Pod | Status |
|-----|--------|
| auth-service-xxxxx | Running |
| payments-service-xxxxx | Running |
| notifications-service-xxxxx | Running |
| api-gateway-xxxxx | Running |

### 8.3 Check health endpoints

```bash
# From host — port-forward each service and test

# Auth service
kubectl port-forward -n nexuspay svc/auth-service 4001:4000 &
curl -s http://localhost:4001/health/live
curl -s http://localhost:4001/health/ready

# Payments service
kubectl port-forward -n nexuspay svc/payments-service 4002:4000 &
curl -s http://localhost:4002/health/live
curl -s http://localhost:4002/health/ready

# Notifications service
kubectl port-forward -n nexuspay svc/notifications-service 4003:4000 &
curl -s http://localhost:4003/health/live
curl -s http://localhost:4003/health/ready

# API gateway
kubectl port-forward -n nexuspay svc/api-gateway 4000:4000 &
curl -s http://localhost:4000/health/live
curl -s http://localhost:4000/health/ready
```

All endpoints should return `200 OK` with a JSON body indicating readiness.

---

## 9. Access Services via Port-Forward

Port-forward the API gateway to access the platform externally:

```bash
kubectl port-forward -n nexuspay svc/api-gateway 4000:4000
```

The API gateway is now available at `http://localhost:4000`.

You can also access individual services for debugging:

```bash
# Auth service — direct access on port 4001
kubectl port-forward -n nexuspay svc/auth-service 4001:4000

# Payments service — direct access on port 4002
kubectl port-forward -n nexuspay svc/payments-service 4002:4000

# Notifications service — direct access on port 4003
kubectl port-forward -n nexuspay svc/notifications-service 4003:4000
```

### Infrastructure services (for debugging)

```bash
# PostgreSQL
kubectl port-forward -n infrastructure svc/postgresql 5432:5432

# Redis
kubectl port-forward -n infrastructure svc/redis-master 6379:6379

# RabbitMQ Management UI
kubectl port-forward -n infrastructure svc/rabbitmq 15672:15672
```

RabbitMQ management UI is available at `http://localhost:15672` (user: `nexuspay`, password: `nexuspay_mq_2026`).

---

## 10. Smoke Test

Run these commands against the API gateway at `http://localhost:4000`.

> **Important:** All monetary amounts are integer minor units (kobo/cents). For example, ₦100.00 = `10000`.

### 10.1 Register a user

```bash
curl -s -X POST http://localhost:4000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "suleiman@nexuspay.dev",
    "password": "SecurePass123!",
    "fullName": "Suleiman Developer"
  }' | jq .
```

### 10.2 Login and extract tokens

```bash
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:4000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "suleiman@nexuspay.dev",
    "password": "SecurePass123!"
  }')

echo "$LOGIN_RESPONSE" | jq .

# Extract the access token
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.accessToken')
echo "Token: $ACCESS_TOKEN"
```

### 10.3 Verify authenticated request

```bash
curl -s http://localhost:4000/v1/users/me \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

### 10.4 Create a payment

```bash
curl -s -X POST http://localhost:4000/v1/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Idempotency-Key: smoke-test-001" \
  -d '{
    "amountMinor": 5000,
    "currency": "NGN",
    "provider": "MOCK_TRANSFER",
    "metadata": { "description": "Smoke test payment" }
  }' | jq .
```

The `amountMinor` field is **5000** which represents ₦50.00 in kobo.

### 10.5 List payments

```bash
curl -s http://localhost:4000/v1/payments \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

### 10.6 Check notifications

```bash
curl -s http://localhost:4000/v1/notifications \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq .
```

### 10.7 View API documentation

Open the interactive Swagger UI in your browser:

```
http://localhost:4000/docs/
```

---

## 13. Deploying to Other Environments

Your Docker images are portable. Once built locally, you can deploy them anywhere with Docker or Kubernetes.

### Option A: Push to a container registry (recommended)

This is how production deployments work. Push images to Docker Hub, GitHub Container Registry (GHCR), AWS ECR, or any OCI-compatible registry.

```bash
# Login to your registry (example: Docker Hub)
docker login

# Tag images for your registry
docker tag nexuspay-platform-auth-service:latest youruser/nexuspay-auth:latest
docker tag nexuspay-platform-payments-service:latest youruser/nexuspay-payments:latest
docker tag nexuspay-platform-notifications-service:latest youruser/nexuspay-notifications:latest
docker tag nexuspay-platform-api-gateway:latest youruser/nexuspay-gateway:latest

# Push to registry
docker push youruser/nexuspay-auth:latest
docker push youruser/nexuspay-payments:latest
docker push youruser/nexuspay-notifications:latest
docker push youruser/nexuspay-gateway:latest
```

Then update the `image.repository` in your Helm values files to point to your registry:

```yaml
# values-prod.yaml
image:
  repository: youruser/nexuspay-auth
  tag: latest
  pullPolicy: Always
```

### Option B: Export and import (no registry needed)

Use this for air-gapped environments or one-off transfers.

```bash
# Export images as tarballs
docker save nexuspay-platform-auth-service:latest | gzip > nexuspay-auth.tar.gz
docker save nexuspay-platform-payments-service:latest | gzip > nexuspay-payments.tar.gz
docker save nexuspay-platform-notifications-service:latest | gzip > nexuspay-notifications.tar.gz
docker save nexuspay-platform-api-gateway:latest | gzip > nexuspay-gateway.tar.gz

# Transfer files to target machine, then load:
docker load < nexuspay-auth.tar.gz
docker load < nexuspay-payments.tar.gz
docker load < nexuspay-notifications.tar.gz
docker load < nexuspay-gateway.tar.gz
```

### Option C: Load into Minikube on another machine

```bash
# On target machine with Minikube running
minikube image load nexuspay-auth.tar.gz
minikube image load nexuspay-payments.tar.gz
minikube image load nexuspay-notifications.tar.gz
minikube image load nexuspay-gateway.tar.gz
```

---

## 14. Optional — Install ArgoCD for GitOps

If you want to manage deployments via GitOps:

### 11.1 Create the argocd namespace

```bash
kubectl create namespace argocd
```

### 11.2 Install ArgoCD

```bash
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

Wait for ArgoCD to become ready:

```bash
kubectl wait --namespace argocd \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/name=argocd-server \
  --timeout=300s
```

### 11.3 Access the ArgoCD UI

```bash
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

Open `https://localhost:8080` in your browser. Retrieve the initial admin password:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d && echo
```

Login with username `admin` and the password above.

### 11.4 Apply the project and application manifests

```bash
kubectl apply -f infra/kubernetes/argocd/
```

This applies the `AppProject` and `ApplicationSet` definitions so ArgoCD can manage the NexusPay services.

### 11.5 Apply Gatekeeper policies (optional)

```bash
kubectl apply -f infra/kubernetes/policies/
```

---

## 15. Cleanup

### Remove application releases

```bash
helm uninstall api-gateway -n nexuspay
helm uninstall notifications-service -n nexuspay
helm uninstall payments-service -n nexuspay
helm uninstall auth-service -n nexuspay
```

### Remove infrastructure releases

```bash
helm uninstall rabbitmq -n infrastructure
helm uninstall redis -n infrastructure
helm uninstall postgresql -n infrastructure
```

### Remove namespaces

```bash
kubectl delete namespace nexuspay
kubectl delete namespace infrastructure
```

### Remove ArgoCD (if installed)

```bash
kubectl delete namespace argocd
```

### Stop Minikube

```bash
minikube stop
```

### Destroy the cluster entirely

```bash
minikube delete
```

### Remove packaged library chart

```bash
rm -f nexuspay-lib-*.tgz
```

---

## 16. Troubleshooting

### Pod stuck in `CrashLoopBackOff`

Check logs:

```bash
kubectl logs -n nexuspay <pod-name> --tail=100
```

Common causes:
- Database is not reachable — verify PostgreSQL is running in the `infrastructure` namespace.
- Secret is missing — ensure the secret referenced in `values-dev.yaml` exists in the `nexuspay` namespace.
- Prisma migrations not applied — see [Section 7](#7-apply-prisma-migrations).

### notifications-service failing to start

The notifications-service depends on RabbitMQ. If RabbitMQ is not fully ready when the service starts, the connection will fail.

```bash
# Verify RabbitMQ is ready
kubectl get pods -n infrastructure -l app.kubernetes.io/name=rabbitmq

# Restart the notifications-service pod to retry the connection
kubectl rollout restart deployment notifications-service -n nexuspay
```

### payments-service: idempotencyRecord table missing

The payments-service requires the `idempotencyRecord` table. Run the Prisma migration:

```bash
PAYMENTS_POD=$(kubectl get pods -n nexuspay -l app.kubernetes.io/name=payments-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it -n nexuspay $PAYMENTS_POD -- npx prisma migrate deploy
```

### auth-service: users/roles/refresh_tokens tables missing

```bash
AUTH_POD=$(kubectl get pods -n nexuspay -l app.kubernetes.io/name=auth-service -o jsonpath='{.items[0].metadata.name}')
kubectl exec -it -n nexuspay $AUTH_POD -- npx prisma migrate deploy
```

### Health endpoints returning non-200

Check if the service has started its HTTP server:

```bash
kubectl logs -n nexuspay <pod-name> --tail=50 | grep -i "listening\|started\|ready"
```

Ensure the port in `values-dev.yaml` matches the container port (default `4000`).

### Minikube VM out of resources

```bash
# Check resource usage
minikube ssh "free -h"
minikube ssh "df -h /"

# If memory is exhausted, stop and restart with more resources
minikube stop
minikube start --cpus=6 --memory=12288 --disk-size=50g
```

### Cannot connect to services via port-forward

Ensure you are using the correct service name and port:

```bash
kubectl get svc -n nexuspay
kubectl get svc -n infrastructure
```

### Helm dependency update fails

Ensure the library chart is packaged:

```bash
ls nexuspay-lib-*.tgz
```

If the file is missing, repackage:

```bash
helm package infra/kubernetes/helm/nexuspay-lib
```

### RabbitMQ management plugin not accessible

The management plugin runs on port `15672`. Verify the service exposes it:

```bash
kubectl get svc -n infrastructure rabbitmq -o yaml
```

If the port is missing, reinstall RabbitMQ with the `plugins` value set to include `rabbitmq_management`.

### Prisma binary missing in container

If `npx prisma migrate deploy` fails with a binary not found error, the container image may need the Prisma engine. Check the Dockerfile for each service to ensure it includes `prisma` and `@prisma/client` as production dependencies.

### General debugging workflow

```bash
# 1. List all pods and their status
kubectl get pods -A | grep -E "nexuspay|infrastructure"

# 2. Describe a failing pod
kubectl describe pod -n nexuspay <pod-name>

# 3. Check events
kubectl get events -n nexuspay --sort-by=.lastTimestamp

# 4. Shell into a pod for interactive debugging
kubectl exec -it -n nexuspay <pod-name> -- /bin/sh

# 5. Check ConfigMaps
kubectl get configmap -n nexuspay -o yaml

# 6. Check Secrets (metadata only — won't show values)
kubectl get secrets -n nexuspay
```

# Data layer (nexuspay-data namespace)

Stateful dependencies are installed with Bitnami charts, release names fixed so
the service values files and `bootstrap-secrets.sh` URLs stay valid:

| Release    | Chart                    | In-cluster address                                            |
|------------|--------------------------|---------------------------------------------------------------|
| postgres   | bitnami/postgresql       | `postgres-postgresql.nexuspay-data.svc.cluster.local:5432`    |
| redis      | bitnami/redis            | `redis-master.nexuspay-data.svc.cluster.local:6379`           |
| rabbitmq   | bitnami/rabbitmq         | `rabbitmq.nexuspay-data.svc.cluster.local:5672`               |
| mailpit    | axllent/mailpit (chart)  | `mailpit.nexuspay-data.svc.cluster.local:1025` (SMTP catch-all)|

## Install order (minikube)

```bash
kubectl create namespace nexuspay-data

helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Postgres: one instance, three databases (auth/payments/notifications)
helm upgrade --install postgres bitnami/postgresql -n nexuspay-data \
  --set auth.username=nexuspay \
  --set auth.password="$(openssl rand -hex 16)" \
  --set auth.database=nexuspay_auth \
  --set primary.initdb.scripts."init-multi\.sql"="CREATE DATABASE nexuspay_payments; CREATE DATABASE nexuspay_notifications;"

helm upgrade --install redis bitnami/redis -n nexuspay-data \
  --set architecture=standalone \
  --set auth.enabled=false

helm upgrade --install rabbitmq bitnami/rabbitmq -n nexuspay-data \
  --set auth.username=nexuspay \
  --set auth.password="$(openssl rand -hex 16)"

helm repo add axllent https://axllent.github.io/mailpit/ && helm repo update
helm upgrade --install mailpit axllent/mailpit -n nexuspay-data
```

Passwords printed by Helm must match what `bootstrap-secrets.sh` generated —
simplest flow on a laptop is to run the Helm installs first, read back the
passwords (`kubectl -n nexuspay-data get secret ... -o jsonpath=...`), then feed
them into the secret bootstrap instead of letting it randomize. For the AKS
sprint this entire namespace disappears: Postgres moves to Azure Flexible
Server, secrets move to Key Vault CSI.

## Migrations

Prisma migrations run as a pre-sync Argo hook or a one-off Job:

```bash
kubectl -n nexuspay-dev run prisma-migrate-auth --rm -it \
  --image=nexuspay/auth-service:dev --restart=Never \
  -- npx prisma migrate deploy
```

(Repeat per service; CI owns this in prod.)

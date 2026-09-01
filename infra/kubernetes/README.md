# infra/kubernetes — GitOps layer (minikube first, AKS later)

```
kubernetes/
├── argocd/
│   ├── project.yaml          # AppProject: repo + destination namespaces pinned
│   └── applicationset.yaml   # matrix generator: services/* × {dev, prod}
├── helm/
│   ├── nexuspay-lib/         # library chart: deployment, service, HPA, PDB, NetworkPolicy, ServiceMonitor
│   └── services/
│       ├── api-gateway/
│       ├── auth-service/
│       ├── payments-service/
│       └── notifications-service/
│           # each: Chart.yaml + values.yaml + values-dev.yaml + values-prod.yaml
├── policies/                 # Gatekeeper ConstraintTemplates + constraints (prod only)
├── data/                     # datastore install guide (bitnami postgres/redis/rabbitmq + mailpit)
└── scripts/bootstrap-secrets.sh
```

## One-time bootstrap on minikube

```bash
minikube start -p nexuspay --cpus=4 --memory=8g --driver=docker

# 1. ArgoCD itself
helm repo add argo https://argoproj.github.io/argo-helm && helm repo update
helm upgrade --install argocd argo/argo-cd -n argocd --create-namespace \
  --set server.insecure=true

# 2. Datastores (see ../data/README.md), then secrets:
bash scripts/bootstrap-secrets.sh nexuspay-dev
bash scripts/bootstrap-secrets.sh nexuspay-prod

# 3. Images: build inside minikube's docker daemon so no registry is needed
eval $(minikube -p nexuspay docker-env)
for svc in api-gateway auth-service payments-service notifications-service; do
  docker build -t nexuspay/$svc:dev ../../../services/$svc
done

# 4. Policies then GitOps
kubectl apply -f policies/
kubectl apply -f argocd/project.yaml
kubectl apply -f argocd/applicationset.yaml

# Watch it converge
kubectl argo rollouts get ... # or simply:
argocd app list && kubectl get pods -n nexuspay-dev
```

## The promotion loop (the story this tells)

1. CI builds `services/<svc>` → pushes image to ACR → **opens PR bumping
   `values-prod.yaml` tag**.
2. Merging the PR = deploying to prod. ArgoCD auto-syncs; nothing is kubectl'd by hand.
3. Dev namespace tracks the same charts with local `dev` tags for iteration.
4. Gatekeeper denies any prod workload without resource limits or from a
   non-ACR registry — the guardrails are enforced at admission, not in docs.

## Status / next pieces

- [x] Library chart + 4 service charts (dev/prod overlays)
- [x] AppProject + ApplicationSet (automated sync, prune, selfHeal)
- [x] Admission policies (resource limits, approved registries)
- [ ] kube-prometheus-stack dashboards-as-code (reuse D1 assets)
- [ ] Istio strict mTLS + Kiali (last — heaviest component)

# infra/ — Kubernetes + Terraform

## kubernetes/ (built — see kubernetes/README.md)

- `helm/nexuspay-lib` + `helm/services/*` — library chart and the four service
  charts with dev/prod overlays (HPA, PDB, NetworkPolicy, ServiceMonitor)
- `argocd/` — AppProject + ApplicationSet driving both environments
- `policies/` — Gatekeeper admission guardrails for prod
- `data/`, `scripts/` — datastore install guide and secrets bootstrap

Remaining in this layer: kube-prometheus-stack dashboards-as-code, Istio mTLS.

## terraform/ (AKS sprint — not started)

Populated only after the minikube GitOps loop is proven ($0), then destroyed
after evidence capture (~$40–50 Azure credit):

```
terraform/
├── modules/          # vnet, aks, acr, postgres, keyvault
└── environments/
    ├── dev/
    └── prod/
```

Order: VNET → ACR → Key Vault → PostgreSQL Flexible → AKS. The ACR name from
Terraform output replaces `acrname.azurecr.io` placeholders in values-prod.yaml.

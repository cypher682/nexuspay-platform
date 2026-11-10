# infra/ — Kubernetes, Terraform and Ansible

## kubernetes/ (live)

- `helm/nexuspay-lib` + `helm/services/*` — library chart and seven service charts, prod
  overlays with digest pins, PDBs, NetworkPolicies and ServiceMonitors
- `argocd/` — AppProject + ApplicationSet (auto-sync, self-heal) and platform apps
- `policies/` — Gatekeeper constraints and templates
- `network-policies/` — default-deny plus per-service egress
- `data/`, `scripts/` — datastore install notes and secrets bootstrap

This is the path that actually deploys: ArgoCD reconciles `main` onto the k3s cluster.
See `docs/k3s-gitops-deployment.md`.

## terraform/ (scaffold, never applied)

Managed Kubernetes on OKE, EKS and AKS with arm64 node pools, one root module per cloud.
CI runs `fmt`, `init -backend=false` and `validate`; no state or credentials exist in the repo.
Start with `terraform/README.md`.

## ansible/ (scaffold, never run)

Installs cert-manager, ArgoCD and Gatekeeper on an existing cluster via Helm. CI runs
`ansible-lint` and `--syntax-check`. Start with `ansible/README.md`.

Status of everything in this directory: [`../docs/capability-status.md`](../docs/capability-status.md).

# Terraform and Ansible scaffold

Status as of 2026-11-10: **written and CI-validated, never applied.** No cloud resource in this
repository was created by Terraform, and the Ansible playbook has never been run. The live
platform is still the hand-built k3s cluster documented in
[k3s-gitops-deployment.md](k3s-gitops-deployment.md).

The goal is a portable, honest starting point for running the same charts on a managed
Kubernetes service, without pretending the live environment was provisioned this way.

## What exists

| Piece | Path | What it provisions | CI check |
|---|---|---|---|
| OKE module | `infra/terraform/modules/oke-cluster` | VCN, public API/node/LB subnets, security lists, OKE Basic cluster, A1.Flex node pool | `fmt`, `init -backend=false`, `validate` |
| EKS module | `infra/terraform/modules/eks-cluster` | VPC and public subnets, EKS cluster, AL2023 arm64 managed node group, OIDC output | same |
| AKS module | `infra/terraform/modules/aks-cluster` | Resource group, VNet/subnet, AKS Free tier, arm64 system node pool, workload identity enabled | same |
| Env roots | `infra/terraform/environments/{oci,aws,azure}-lab` | Provider configuration and module call per cloud | same |
| Addons role | `infra/ansible/roles/addons` | cert-manager, ArgoCD, Gatekeeper via Helm | `ansible-lint`, `--syntax-check` |
| Workflow | `.github/workflows/iac.yml` | Runs the checks on changes to `infra/terraform` or `infra/ansible` | it is the check |

Everything uses arm64 node types because the published images are arm64 only. Retargeting to
amd64 means changing the instance type and `ami_type`/`vm_size` and letting `publish.yml`
produce amd64 images as well.

## Why managed clusters rather than k3s on a VM

The live cluster runs k3s on a single free A1.Flex instance: zero cost, but it exercises
node-level operations, not cloud platform work. Managed services add the parts that matter in
a cloud role:

- control plane lifecycle and version upgrades handled by the provider
- managed node pools and cloud IAM for cluster access
- cloud load balancers and storage classes for `Service`/`PersistentVolumeClaim`
- a natural place for IRSA / workload identity (the EKS and AKS modules already expose OIDC)

The trade-off is cost. OKE Basic plus free-tier A1 capacity stays close to $0; AKS Free has no
control-plane fee but bills nodes; EKS bills the control plane by the hour. The scaffold is
therefore plan-and-validate only until someone explicitly chooses to spend.

## How it would be used

```bash
# 1. Provision (not done in this repository)
cd infra/terraform/environments/oci-lab
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform plan && terraform apply

# 2. Point kubectl at the cluster
terraform output -raw kubeconfig_command | bash

# 3. Install cluster addons
cd ../../../ansible
ansible-playbook -i inventory/hosts.example.ini playbooks/cluster-addons.yml

# 4. Apply the GitOps entrypoint after creating runtime secrets
kubectl apply -f ../kubernetes/argocd/project.yaml
kubectl apply -f ../kubernetes/argocd/applicationset.yaml
```

Step 4 is deliberately manual: the ApplicationSet syncs the production overlays, and those
expect the `nexuspay-shared`, per-database and RabbitMQ secrets described in the deployment
guide. Applying it earlier leaves pods stuck rather than giving useful feedback.

## Deliberate gaps

- **No remote state.** Local state only, and it is gitignored. A real setup needs an encrypted
  bucket or container, locking, and per-environment state paths before more than one person
  touches it.
- **No secrets management in the graph.** Secrets are created out of band; the ESO/Vault path
  remains a scaffold.
- **No ingress/DNS automation.** Traefik and cert-manager are installed by Ansible and
  kube-prometheus-stack is not; DNS records and the `sslip.io` style hostname are manual.
- **No node autoscaling tuning.** Node counts are fixed inputs.
- **No drift detection.** `terraform plan` in CI would need read-only credentials and would
  still fail on state locking; not attempted.
- **OKE node image is an input, not a lookup.** OKE node images are tied to the Kubernetes
  version and CPU architecture. The module avoids guessing and asks for the OCID; the README
  documents the `oci ce node-pool-options get` command.

## Relationship to the live cluster

The k3s host was created by hand in the OCI console, and its addons were installed manually.
Reproducing that with this scaffold would still require the parts listed under deliberate gaps.
Treat the two as parallel paths: the live cluster is the evidence, the scaffold is the portable
blueprint.

See also [capability-status.md](capability-status.md) for what is verified live versus merely
written.

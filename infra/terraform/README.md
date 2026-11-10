# Terraform — managed Kubernetes on three clouds

Scaffold for the same platform on **OKE (Oracle), EKS (AWS) and AKS (Azure)**. The modules
create a managed control plane, one arm64 node pool, and the network around it, then export
the command that writes a kubeconfig. Ansible (`../ansible`) installs cert-manager, ArgoCD and
Gatekeeper on whichever cluster you create.

**Status: validated in CI (`fmt` + `init -backend=false` + `validate`), never applied.** No
state, no credentials, and no real resources have been created from this directory. The live
platform still runs on the hand-built single-node k3s cluster.

## Layout

```
modules/
  oke-cluster/    # VCN, subnets, security lists, OKE Basic cluster, A1.Flex node pool
  eks-cluster/    # VPC + public subnets, EKS cluster, AL2023 arm64 managed node group
  aks-cluster/    # Resource group, VNet/subnet, AKS Free tier, arm64 system pool
environments/
  oci-lab/        # module call for OKE
  aws-lab/        # module call for EKS
  azure-lab/      # module call for AKS
```

Each environment is a separate root module because the provider authentication differs.

## Cost before you apply

| Target | Control plane | Nodes | Notes |
|---|---|---|---|
| OKE Basic | free | A1.Flex free-tier capacity | Closest to $0; capacity is regional and often scarce |
| AKS Free | free | ~$30–60/month for two small arm64 nodes | Free tier has no uptime SLA |
| EKS | ~$73/month | plus two `t4g.small` nodes | Most expensive; strongest market signal |

Destroy after capturing evidence. Nothing here is applied automatically.

## Usage (not yet executed)

```bash
cd environments/oci-lab
cp terraform.tfvars.example terraform.tfvars   # gitignored
terraform init
terraform plan
# terraform apply   # deliberately not run
```

Then point kubectl at the new cluster:

```bash
terraform output -raw kubeconfig_command | bash        # OKE
# aws eks update-kubeconfig --region eu-central-1 --name nexuspay-eks
# az aks get-credentials --resource-group nexuspay-rg --name nexuspay-aks
```

Authentication is expected from the environment, never from this repository:

- OCI: `~/.oci/config` profile (default `DEFAULT`)
- AWS: `AWS_PROFILE` / `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`, or SSO
- Azure: `az login`, or `ARM_SUBSCRIPTION_ID` / `ARM_TENANT_ID` / `ARM_CLIENT_ID` / `ARM_CLIENT_SECRET`

## Required inputs

- `compartment_ocid` and `node_image_id` for OKE. The node image OCID is version- and
  architecture-specific; list valid values with
  `oci ce node-pool-options get --node-pool-option-id all`. Pick an `aarch64` image that
  matches the Kubernetes version.
- Nothing beyond credentials for EKS and AKS; versions and sizes have defaults.

## What it deliberately does not do

- No remote state backend. Add an encrypted bucket/container per environment before team use.
- No DNS, TLS issuer or ingress controller; cert-manager and Traefik are installed later.
- No secrets, no workload manifests, no image builds. ArgoCD points at this repository and
  expects the runtime secrets described in `docs/k3s-gitops-deployment.md`.
- No cloud-specific load balancer integration; a Service of type `LoadBalancer` will provision
  one per cloud once the charts are deployed.

Design notes and the gap analysis live in
[`../../docs/iac-terraform-ansible.md`](../../docs/iac-terraform-ansible.md).

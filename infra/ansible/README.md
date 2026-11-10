# Ansible — cluster addons

Installs the platform's three cluster-wide dependencies on an existing cluster, using the
kubeconfig that is current on the operator machine.

- cert-manager (pinned to `v1.21.3`, matching the live cluster)
- ArgoCD (chart version optional; set `addons_argocd_chart_version` to pin)
- Gatekeeper (chart version optional; set `addons_gatekeeper_chart_version` to pin)

**Status: linted and syntax-checked in CI, never run.** It is scaffolding for a future
managed-cluster rollout, not a record of how the live k3s cluster was built.

## Prerequisites

- `kubectl` and `helm` on the machine that runs the playbook
- A reachable cluster and a kubeconfig context pointing at it
- Network access to the Jetstack, Argo and Gatekeeper chart repositories

## Usage

```bash
cd infra/ansible
ansible-playbook -i inventory/hosts.example.ini playbooks/cluster-addons.yml
```

The playbook runs on `localhost`; it does not SSH anywhere and does not touch the nodes.

After it finishes, review `infra/kubernetes/argocd/project.yaml` and
`applicationset.yaml`, create the runtime secrets, and apply them. The playbook intentionally
does not apply the ApplicationSet, because syncing workloads before secrets exist would leave
the cluster in a partially failed state.

## Variables

| Variable | Default | Purpose |
|---|---|---|
| `addons_cert_manager_version` | `v1.21.3` | cert-manager chart version |
| `addons_argocd_chart_version` | `""` (latest) | argo-cd chart version |
| `addons_gatekeeper_chart_version` | `""` (latest) | gatekeeper chart version |
| `addons_cert_manager_namespace` | `cert-manager` | install namespace |
| `addons_argocd_namespace` | `argocd` | install namespace |
| `addons_gatekeeper_namespace` | `gatekeeper-system` | install namespace |

Override on the command line, e.g. `-e addons_argocd_chart_version=9.1.0`.

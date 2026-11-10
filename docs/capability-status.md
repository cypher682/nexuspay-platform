# Capability status

A single place to separate what has been proven from what has only been written. Updated
2026-11-10.

| Label | Meaning |
|---|---|
| **Verified live** | Running on the k3s cluster or public gateway, with evidence captured |
| **Validated in CI** | Formatting, linting and static validation pass; never applied or executed |
| **Scaffold (unrun)** | Files exist and are documented; no validation and no execution |
| **Absent** | Not built, even if desirable |

## Platform

| Capability | Status | Evidence / note |
|---|---|---|
| Seven services behind the gateway | Verified live | 17/17 pods `up=1`, 11 ArgoCD apps `Synced/Healthy` |
| Public HTTPS endpoint | Verified live | `https://nexuspay.141-148-69-94.sslip.io`, `/health/ready` 200, `/docs` 200 |
| GitOps reconciliation | Verified live | ArgoCD `ApplicationSet`, auto-sync + self-heal |
| Migrations as PreSync Jobs | Verified live | `reporting-service` migrated `reporting-db` on sync |
| Feature flags, fraud gate, reporting | Verified live | E2E flows and Prometheus counters captured |
| Nightly reporting CronJob | Verified live | Manual trigger wrote 3 rows through `dist/jobs/snapshot.js` |
| Snapshot failure/staleness alerts | Verified live | Rules loaded; a simulated failed job reached `pending`; staleness expression returns a valid age |
| Prometheus + Grafana + alerts | Verified live | 17/17 targets, dashboard ConfigMap, Mailpit alert delivery |
| Bare-metal host/workload signals | Verified live | 5 rules loaded: disk >85%, memory >90%, restart loop, replica shortfall, Pending PVC; baselines below threshold |
| Distributed tracing backend | Absent on k3s | OTel SDK wired but disabled; Jaeger only exists in Compose |
| Loki log aggregation on k3s | Absent | Compose only |
| Customer web UI | Absent | Swagger UI at `/docs` is the only browser surface |
| Static status/landing page | Absent | Discussed; not built |

## Delivery

| Capability | Status | Evidence / note |
|---|---|---|
| CI (lint, types, tests, OpenAPI drift, Trivy, k6 smoke) | Verified live | Green on every merge to `main` |
| arm64 image publishing with digests | Verified live | `publish.yml`; prod values pin digests |
| Image signing (cosign) | Absent | Workflow step removed; needs `COSIGN_PRIVATE_KEY` and a verification policy |
| SBOM generation/attestation | Absent | Trivy scans only |
| Terraform modules (OKE/EKS/AKS) | Validated in CI | `fmt`, `init -backend=false`, `validate`; never applied |
| Ansible addon playbook | Validated in CI | `ansible-lint` and `--syntax-check`; never run |
| Remote Terraform state | Absent | Local state only, gitignored |
| Ingress/DNS automation | Absent | Traefik + cert-manager installed manually; hostname is manual |

## Security and operations

| Capability | Status | Evidence / note |
|---|---|---|
| Default-deny NetworkPolicies | Verified live | App-specific egress rules including reporting |
| Pod Security Admission `restricted` | Verified live | Enforced on `nexuspay-prod` |
| Gatekeeper admission policies | Verified live | Allowed registries, digest requirement, resources |
| Secrets in-cluster | Verified live | Manually created; documented in the deployment guide |
| External Secrets / Vault injection | Scaffold (unrun) | Vault exists in Compose only; no ESO controller |
| WAF / ingress migration | Absent | Deferred by choice; Traefik is the edge |
| Backup and restore | Absent | No Velero or database backup job |
| Disaster recovery runbook | Partial | Rollback steps exist; no restore drill evidence |
| Cost controls/quotas | Partial | Limits/requests set; no ResourceQuota or budget alert |

## Keeping this honest

If a row says **Verified live**, the evidence is reproducible from the commands in the linked
runbook. If a row says **Validated in CI**, do not describe the capability as working; it has
passed static checks only. Update this table when a scaffold is executed or a gap is closed.

output "cluster_endpoint" {
  description = "Public Kubernetes API endpoint."
  value       = module.cluster.cluster_endpoint
}

output "cluster_id" {
  description = "OKE cluster OCID."
  value       = module.cluster.cluster_id
}

output "kubeconfig_command" {
  description = "Command that writes a kubeconfig for the cluster."
  value       = module.cluster.kubeconfig_command
}

output "cluster_name" {
  description = "EKS cluster name."
  value       = module.cluster.cluster_name
}

output "cluster_endpoint" {
  description = "Public Kubernetes API endpoint."
  value       = module.cluster.cluster_endpoint
}

output "update_kubeconfig_command" {
  description = "Command that writes a kubeconfig for the cluster."
  value       = module.cluster.update_kubeconfig_command
}

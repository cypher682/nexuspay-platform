output "cluster_name" {
  description = "AKS cluster name."
  value       = module.cluster.cluster_name
}

output "cluster_fqdn" {
  description = "Kubernetes API FQDN."
  value       = module.cluster.cluster_fqdn
}

output "kubeconfig_command" {
  description = "Command that writes a kubeconfig for the cluster."
  value       = module.cluster.kubeconfig_command
}

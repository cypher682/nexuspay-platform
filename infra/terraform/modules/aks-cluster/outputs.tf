output "resource_group_name" {
  description = "Resource group that owns the cluster."
  value       = azurerm_resource_group.this.name
}

output "cluster_name" {
  description = "AKS cluster name."
  value       = azurerm_kubernetes_cluster.this.name
}

output "cluster_fqdn" {
  description = "Kubernetes API FQDN."
  value       = azurerm_kubernetes_cluster.this.fqdn
}

output "kubeconfig_command" {
  description = "Command that writes a kubeconfig for the cluster."
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.this.name} --name ${azurerm_kubernetes_cluster.this.name} --overwrite-existing"
}

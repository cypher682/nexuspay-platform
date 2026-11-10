output "cluster_id" {
  description = "OCID of the OKE cluster."
  value       = oci_containerengine_cluster.this.id
}

output "cluster_endpoint" {
  description = "Public Kubernetes API endpoint."
  value       = oci_containerengine_cluster.this.endpoints[0].public_endpoint
}

output "node_pool_id" {
  description = "OCID of the worker node pool."
  value       = oci_containerengine_node_pool.this.id
}

output "kubeconfig_command" {
  description = "Command that writes a kubeconfig for the new cluster."
  value       = "oci ce cluster create-kubeconfig --cluster-id ${oci_containerengine_cluster.this.id} --file $HOME/.kube/config --region ${var.region} --token-version 2.0.0"
}

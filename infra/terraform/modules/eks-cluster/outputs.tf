output "cluster_name" {
  description = "EKS cluster name."
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "Public Kubernetes API endpoint."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 CA bundle for the cluster."
  value       = module.eks.cluster_certificate_authority_data
  sensitive   = true
}

output "oidc_provider_arn" {
  description = "OIDC provider ARN, used to build IRSA roles."
  value       = module.eks.oidc_provider_arn
}

output "vpc_id" {
  description = "VPC that hosts the cluster."
  value       = module.vpc.vpc_id
}

output "update_kubeconfig_command" {
  description = "Command that writes a kubeconfig for the cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}

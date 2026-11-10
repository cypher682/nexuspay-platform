variable "region" {
  description = "AWS region."
  type        = string
  default     = "eu-central-1"
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
  default     = "nexuspay"
}

variable "kubernetes_version" {
  description = "EKS control plane version."
  type        = string
  default     = "1.31"
}

variable "instance_type" {
  description = "arm64 instance type for the managed node group."
  type        = string
  default     = "t4g.small"
}

variable "node_count" {
  description = "Desired worker node count."
  type        = number
  default     = 2
}

variable "max_node_count" {
  description = "Maximum worker node count."
  type        = number
  default     = 2
}

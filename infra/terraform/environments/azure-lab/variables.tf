variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
  default     = "nexuspay"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "westeurope"
}

variable "kubernetes_version" {
  description = "AKS version. Null uses the current default."
  type        = string
  default     = null
}

variable "vm_size" {
  description = "arm64 node VM size."
  type        = string
  default     = "Standard_B2pls_v2"
}

variable "node_count" {
  description = "System node pool size."
  type        = number
  default     = 2
}

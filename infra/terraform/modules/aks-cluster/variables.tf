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
  description = "AKS version. Null lets AKS pick the current default."
  type        = string
  default     = null
}

variable "vm_size" {
  description = "arm64 node VM size available in the chosen region."
  type        = string
  default     = "Standard_B2pls_v2"
}

variable "node_count" {
  description = "System node pool size."
  type        = number
  default     = 2
}

variable "vnet_cidr" {
  description = "CIDR for the virtual network."
  type        = string
  default     = "10.20.0.0/16"
}

variable "node_subnet_cidr" {
  description = "CIDR for the node subnet (Azure CNI assigns pod IPs from it)."
  type        = string
  default     = "10.20.0.0/22"
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    project = "nexuspay"
    env     = "lab"
  }
}

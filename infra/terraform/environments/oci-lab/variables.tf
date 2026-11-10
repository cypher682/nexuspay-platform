variable "compartment_ocid" {
  description = "OCID of the compartment that will own the cluster."
  type        = string
}

variable "node_image_id" {
  description = "OKE aarch64 node image OCID (see `oci ce node-pool-options get --node-pool-option-id all`)."
  type        = string
}

variable "oci_config_profile" {
  description = "Profile name in ~/.oci/config."
  type        = string
  default     = "DEFAULT"
}

variable "region" {
  description = "OCI region identifier."
  type        = string
  default     = "eu-frankfurt-1"
}

variable "kubernetes_version" {
  description = "OKE Kubernetes version."
  type        = string
  default     = "v1.31.1"
}

variable "node_shape" {
  description = "Worker node shape."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "OCPUs per worker node."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "Memory per worker node."
  type        = number
  default     = 12
}

variable "node_count" {
  description = "Worker node count."
  type        = number
  default     = 1
}

variable "availability_domain" {
  description = "Optional availability domain name."
  type        = string
  default     = null
}

variable "name_prefix" {
  description = "Prefix for resource names."
  type        = string
  default     = "nexuspay"
}

variable "api_allowed_cidr" {
  description = "Source CIDR allowed to reach the Kubernetes API."
  type        = string
  default     = "0.0.0.0/0"
}

variable "ssh_ingress_cidr" {
  description = "Source CIDR allowed to SSH to worker nodes."
  type        = string
  default     = "0.0.0.0/0"
}

variable "compartment_ocid" {
  description = "OCID of the compartment that owns the cluster."
  type        = string
}

variable "region" {
  description = "OCI region identifier (used only in the kubeconfig helper output)."
  type        = string
  default     = "eu-frankfurt-1"
}

variable "kubernetes_version" {
  description = "OKE Kubernetes version. Check `oci ce cluster-options get --cluster-option-id all`."
  type        = string
  default     = "v1.31.1"
}

variable "node_image_id" {
  description = "OKE worker node image OCID. Get it from `oci ce node-pool-options get --node-pool-option-id all`; it must be an aarch64 image for VM.Standard.A1.Flex."
  type        = string
}

variable "node_shape" {
  description = "Worker node shape. VM.Standard.A1.Flex is the arm64 free-tier shape."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  description = "OCPUs per worker node (flex shapes only)."
  type        = number
  default     = 2
}

variable "memory_in_gbs" {
  description = "Memory per worker node in GB (flex shapes only)."
  type        = number
  default     = 12
}

variable "node_count" {
  description = "Number of worker nodes."
  type        = number
  default     = 1
}

variable "availability_domain" {
  description = "Optional availability domain name. Defaults to the first AD."
  type        = string
  default     = null
}

variable "name_prefix" {
  description = "Prefix for resource display names."
  type        = string
  default     = "nexuspay"
}

variable "vcn_cidr" {
  description = "CIDR for the VCN."
  type        = string
  default     = "10.0.0.0/16"
}

variable "api_subnet_cidr" {
  description = "CIDR for the public API endpoint subnet."
  type        = string
  default     = "10.0.1.0/28"
}

variable "node_subnet_cidr" {
  description = "CIDR for the worker node subnet."
  type        = string
  default     = "10.0.2.0/24"
}

variable "lb_subnet_cidr" {
  description = "CIDR for the service load balancer subnet."
  type        = string
  default     = "10.0.3.0/24"
}

variable "api_allowed_cidr" {
  description = "Source CIDR allowed to reach the public Kubernetes API. Restrict this."
  type        = string
  default     = "0.0.0.0/0"
}

variable "ssh_ingress_cidr" {
  description = "Source CIDR allowed to SSH to worker nodes (for debugging only)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "tags" {
  description = "Freeform tags applied to every resource."
  type        = map(string)
  default = {
    project = "nexuspay"
    env     = "lab"
  }
}

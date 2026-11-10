terraform {
  required_version = ">= 1.9.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

provider "oci" {
  config_file_profile = var.oci_config_profile
  region              = var.region
}

module "cluster" {
  source = "../../modules/oke-cluster"

  compartment_ocid    = var.compartment_ocid
  region              = var.region
  kubernetes_version  = var.kubernetes_version
  node_image_id       = var.node_image_id
  node_shape          = var.node_shape
  ocpus               = var.ocpus
  memory_in_gbs       = var.memory_in_gbs
  node_count          = var.node_count
  availability_domain = var.availability_domain
  name_prefix         = var.name_prefix
  api_allowed_cidr    = var.api_allowed_cidr
  ssh_ingress_cidr    = var.ssh_ingress_cidr
}

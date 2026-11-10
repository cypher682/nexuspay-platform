terraform {
  required_version = ">= 1.9.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {
    resource_group {
      prevent_deletion_if_contains_resources = false
    }
  }
}

module "cluster" {
  source = "../../modules/aks-cluster"

  name_prefix        = var.name_prefix
  location           = var.location
  kubernetes_version = var.kubernetes_version
  vm_size            = var.vm_size
  node_count         = var.node_count
}

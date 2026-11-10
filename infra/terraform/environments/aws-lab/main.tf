terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project = "nexuspay"
      env     = "lab"
    }
  }
}

module "cluster" {
  source = "../../modules/eks-cluster"

  name_prefix        = var.name_prefix
  region             = var.region
  kubernetes_version = var.kubernetes_version
  instance_type      = var.instance_type
  node_count         = var.node_count
  max_node_count     = var.max_node_count
}

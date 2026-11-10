terraform {
  required_version = ">= 1.9.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
  }
}

data "oci_identity_availability_domains" "this" {
  compartment_id = var.compartment_ocid
}

resource "oci_core_vcn" "this" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${var.name_prefix}-vcn"
  dns_label      = "nexuspay"

  freeform_tags = var.tags
}

resource "oci_core_internet_gateway" "this" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-igw"
  enabled        = true

  freeform_tags = var.tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.this.id
  }

  freeform_tags = var.tags
}

resource "oci_core_security_list" "api" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-api-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    description = "Allow all outbound"
  }

  ingress_security_rules {
    protocol    = "6"
    source      = var.api_allowed_cidr
    description = "Kubernetes API"

    tcp_options {
      min = 6443
      max = 6443
    }
  }

  freeform_tags = var.tags
}

resource "oci_core_security_list" "nodes" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-nodes-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    description = "Allow all outbound"
  }

  ingress_security_rules {
    protocol    = "all"
    source      = var.vcn_cidr
    description = "Node-to-node and control-plane-to-node traffic inside the VCN"
  }

  ingress_security_rules {
    protocol    = "6"
    source      = var.ssh_ingress_cidr
    description = "Optional SSH to worker nodes"

    tcp_options {
      min = 22
      max = 22
    }
  }

  freeform_tags = var.tags
}

resource "oci_core_security_list" "lb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.this.id
  display_name   = "${var.name_prefix}-lb-sl"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    description = "Allow all outbound"
  }

  ingress_security_rules {
    protocol    = "6"
    source      = "0.0.0.0/0"
    description = "HTTP and HTTPS"

    tcp_options {
      min = 80
      max = 443
    }
  }

  freeform_tags = var.tags
}

resource "oci_core_subnet" "api" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.this.id
  cidr_block        = var.api_subnet_cidr
  display_name      = "${var.name_prefix}-api"
  dns_label         = "api"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.api.id]

  freeform_tags = var.tags
}

resource "oci_core_subnet" "nodes" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.this.id
  cidr_block        = var.node_subnet_cidr
  display_name      = "${var.name_prefix}-nodes"
  dns_label         = "nodes"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.nodes.id]

  freeform_tags = var.tags
}

resource "oci_core_subnet" "lb" {
  compartment_id    = var.compartment_ocid
  vcn_id            = oci_core_vcn.this.id
  cidr_block        = var.lb_subnet_cidr
  display_name      = "${var.name_prefix}-lb"
  dns_label         = "lb"
  route_table_id    = oci_core_route_table.public.id
  security_list_ids = [oci_core_security_list.lb.id]

  freeform_tags = var.tags
}

resource "oci_containerengine_cluster" "this" {
  compartment_id     = var.compartment_ocid
  name               = "${var.name_prefix}-oke"
  vcn_id             = oci_core_vcn.this.id
  kubernetes_version = var.kubernetes_version
  type               = "BASIC_CLUSTER"

  options {
    service_lb_subnet_ids = [oci_core_subnet.lb.id]

    add_ons {
      is_kubernetes_dashboard_enabled = false
      is_tiller_enabled               = false
    }
  }

  endpoint_config {
    subnet_id            = oci_core_subnet.api.id
    is_public_ip_enabled = true
    nsg_ids              = []
  }

  freeform_tags = var.tags
}

resource "oci_containerengine_node_pool" "this" {
  cluster_id         = oci_containerengine_cluster.this.id
  compartment_id     = var.compartment_ocid
  name               = "${var.name_prefix}-pool"
  node_shape         = var.node_shape
  kubernetes_version = var.kubernetes_version

  node_shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_in_gbs
  }

  node_config_details {
    size = var.node_count

    placement_configs {
      availability_domain = coalesce(var.availability_domain, data.oci_identity_availability_domains.this.availability_domains[0].name)
      subnet_id           = oci_core_subnet.nodes.id
    }
  }

  node_source_details {
    source_type = "IMAGE"
    image_id    = var.node_image_id
  }

  freeform_tags = var.tags
}

variable "linode_token" {
  description = "Linode API token"
  type        = string
  sensitive   = true
}

variable "gcp_project" {
  description = "GCP project ID for DNS management"
  type        = string
}

variable "domain" {
  description = "Relay domain name"
  type        = string
}

variable "email" {
  description = "Email address for LetsEncrypt notifications"
  type        = string
}

variable "ssh_keys" {
  description = "SSH public keys for root access"
  type        = list(string)
}

# Relay node definitions
locals {
  relays = {
    use = {
      region = "us-east"      # Newark, NJ
      type   = "g6-nanode-1"  # 1GB RAM, 1 vCPU, $5/mo
    }
    usw = {
      region = "us-west"      # Fremont, CA
      type   = "g6-nanode-1"
    }
    euc = {
      region = "eu-central"   # Frankfurt, Germany
      type   = "g6-nanode-1"
    }
    sea = {
      region = "ap-south"     # Singapore
      type   = "g6-nanode-1"
    }
  }
}

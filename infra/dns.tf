# DNS zone for relay servers
resource "google_dns_managed_zone" "relay" {
  name     = "relay"
  dns_name = "${var.domain}."
}

# Individual DNS records for each relay node (for direct access)
resource "google_dns_record_set" "relay_node" {
  for_each = local.relays

  name         = "${each.key}.${google_dns_managed_zone.relay.dns_name}"
  managed_zone = google_dns_managed_zone.relay.name
  type         = "A"
  ttl          = 300
  rrdatas      = linode_instance.relay[each.key].ipv4
}

# Global Geo DNS, routing to the closest region
resource "google_dns_record_set" "relay_global" {
  name         = google_dns_managed_zone.relay.dns_name
  managed_zone = google_dns_managed_zone.relay.name
  type         = "A"
  ttl          = 60

  routing_policy {
    dynamic "geo" {
      for_each = local.relay_gcp_regions

      content {
        location = geo.value
        rrdatas = linode_instance.relay[geo.key].ipv4
      }
    }
  }
}

# Region mapping for GCP geo routing
# GCP uses region codes like "us-east1", "us-west1", "europe-west3", "asia-southeast1"
locals {
  relay_gcp_regions = {
    use = "us-east1"        # Newark, NJ -> closest GCP region
    usw = "us-west1"        # Fremont, CA -> closest GCP region
    euc = "europe-west3"    # Frankfurt -> closest GCP region
    sea = "asia-southeast1" # Singapore -> closest GCP region
  }
}

# DNS record for publisher node
resource "google_dns_record_set" "publisher" {
  name         = "pub.${google_dns_managed_zone.relay.dns_name}"
  managed_zone = google_dns_managed_zone.relay.name
  type         = "A"
  ttl          = 300
  rrdatas      = linode_instance.publisher.ipv4
}

# Grant DNS admin permissions to the service account
resource "google_project_iam_member" "dns_admin" {
  project = var.gcp_project
  role    = "roles/dns.admin"
  member  = "serviceAccount:${google_service_account.relay.email}"
}

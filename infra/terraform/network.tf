# 専用の VPC(default ネットワークの許可ルールを持ち込まない。NFR2.3)
resource "google_compute_network" "main" {
  name                    = "mobile-order-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

resource "google_compute_subnetwork" "main" {
  name          = "mobile-order-subnet"
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = "10.10.0.0/24"
  # IPv6 は割り当てない(ipv6_access_type を指定しない。NFR2.3)
}

# 80 番: 所有者の IP からだけ(NFR2.1)。3000 番は開けない。
resource "google_compute_firewall" "allow_http" {
  name          = "mobile-order-allow-http"
  network       = google_compute_network.main.name
  direction     = "INGRESS"
  source_ranges = [var.allowed_ip_cidr]
  target_tags   = ["mobile-order"]

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }
}

# 22 番: IAP の転送の範囲だけ(NFR2.2)
resource "google_compute_firewall" "allow_ssh_iap" {
  name          = "mobile-order-allow-ssh-iap"
  network       = google_compute_network.main.name
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["mobile-order"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# VM 用のサービスアカウント(ロールなし)
resource "google_service_account" "vm" {
  account_id   = "mobile-order-vm"
  display_name = "mobile-order VM"

  depends_on = [google_project_service.enabled]
}

# データディスク(DB の保存先)。VM とは別リソースで、削除から保護する(NFR4.4)。
resource "google_compute_disk" "data" {
  name = "mobile-order-data"
  type = "pd-standard"
  zone = var.zone
  size = 10

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.enabled]
}

locals {
  startup_script = templatefile("${path.module}/startup.sh.tpl", {
    node_version       = var.node_version
    node_sha256        = var.node_sha256
    deployer_unique_id = google_service_account.deployer.unique_id
    sysctl_conf        = trimspace(file("${path.module}/files/sysctl-mobile-order.conf"))
    journald_conf      = trimspace(file("${path.module}/files/journald-mobile-order.conf"))
    service_unit       = trimspace(file("${path.module}/files/mobile-order.service"))
    caddy_dropin       = trimspace(file("${path.module}/files/caddy-order.conf"))
    caddyfile          = trimspace(file("${path.module}/files/Caddyfile"))
    deploy_script      = trimspace(file("${path.module}/files/mobile-order-deploy.sh"))
  })
}

resource "google_compute_instance" "app" {
  name         = "mobile-order-vm"
  machine_type = "e2-micro"
  zone         = var.zone
  tags         = ["mobile-order"]

  # サービスアカウントなどの変更で止めて更新できるようにする
  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 10
      type  = "pd-standard"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.id
    device_name = "mobile-order-data"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id

    # エフェメラルの外部 IPv4(静的 IP は作らない。IPv6 は割り当てない)
    access_config {}
  }

  metadata = {
    enable-oslogin         = "TRUE"
    block-project-ssh-keys = "TRUE"
  }

  metadata_startup_script = local.startup_script

  service_account {
    email  = google_service_account.vm.email
    scopes = ["https://www.googleapis.com/auth/logging.write"]
  }

  depends_on = [google_project_service.enabled]
}

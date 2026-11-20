locals {
  # Terraform が有効にする API(serviceusage、cloudresourcemanager、iam は手順書で手動で有効にする前提)
  enabled_services = toset([
    "compute.googleapis.com",
    "iap.googleapis.com",
    "oslogin.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ])

  owner_member = "user:${var.owner_email}"
}

resource "google_project_service" "enabled" {
  for_each = local.enabled_services

  service            = each.value
  disable_on_destroy = false
}

# ---- デプロイ用のサービスアカウント(キーは作らない。NFR2.4) ----
resource "google_service_account" "deployer" {
  account_id   = "mobile-order-deployer"
  display_name = "mobile-order deployer (GitHub Actions)"

  depends_on = [google_project_service.enabled]
}

# gcloud compute ssh/scp が VM の情報を引くための最小のカスタムロール(roles/compute.viewer は使わない)
resource "google_project_iam_custom_role" "deployer_instance_get" {
  role_id     = "mobileOrderDeployerInstanceGet"
  title       = "mobile-order deployer instance get"
  description = "gcloud compute ssh/scp が VM とプロジェクトのメタデータを読むための最小の権限"
  permissions = ["compute.instances.get", "compute.projects.get"]

  depends_on = [google_project_service.enabled]
}

resource "google_project_iam_member" "deployer_instance_get" {
  project = var.project_id
  role    = google_project_iam_custom_role.deployer_instance_get.id
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# IAP トンネル(VM 単位)
resource "google_iap_tunnel_instance_iam_member" "deployer" {
  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.app.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_iap_tunnel_instance_iam_member" "owner" {
  project  = var.project_id
  zone     = var.zone
  instance = google_compute_instance.app.name
  role     = "roles/iap.tunnelResourceAccessor"
  member   = local.owner_member
}

# OS Login(VM 単位)。デプロイ用は管理者権限なし。sudo は deploy.sh だけ(sudoers)。
resource "google_compute_instance_iam_member" "deployer_os_login" {
  project       = var.project_id
  zone          = var.zone
  instance_name = google_compute_instance.app.name
  role          = "roles/compute.osLogin"
  member        = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_compute_instance_iam_member" "owner_os_admin_login" {
  project       = var.project_id
  zone          = var.zone
  instance_name = google_compute_instance.app.name
  role          = "roles/compute.osAdminLogin"
  member        = local.owner_member
}

# VM のサービスアカウントとして VM を使う権限
resource "google_service_account_iam_member" "deployer_acts_as_vm" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "owner_acts_as_vm" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = local.owner_member
}

# ---- Workload Identity Federation(GitHub Actions の認証。NFR2.5) ----
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "github"

  depends_on = [google_project_service.enabled]
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "github-actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # 本リポジトリの main だけを許可する(repository と ref の両方)
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/main\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

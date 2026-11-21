# GitHub の Environment `production` のシークレットに入れる値(GCP_*)
output "vm_name" {
  description = "GCP_VM_NAME"
  value       = google_compute_instance.app.name
}

output "zone" {
  description = "GCP_ZONE"
  value       = var.zone
}

output "wif_provider" {
  description = "GCP_WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github_actions.name
}

output "deployer_service_account" {
  description = "GCP_DEPLOY_SA"
  value       = google_service_account.deployer.email
}

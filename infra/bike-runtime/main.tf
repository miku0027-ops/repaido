module "dispatch" {

  count                = var.enabled ? 1 : 0
  source               = "./pool"
  project_id           = var.project_id
  region               = var.region
  zones                = var.zones
  image                = var.image
  quota_secret_version = var.quota_secret_version
  minimum_workers      = var.minimum_workers
  maximum_workers      = var.maximum_workers
  events_per_worker    = var.events_per_worker
  alert_email          = var.alert_email

}

output "worker_group" {
  value = try(module.dispatch[0].worker_group, null)
}

output "subscription" {
  value = try(module.dispatch[0].subscription, null)
}

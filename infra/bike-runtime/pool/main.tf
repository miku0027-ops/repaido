terraform {

  required_providers {
    google = {
      source = "hashicorp/google", version = "6.50.0"
    }

  }


}

locals {

  name         = "repaido-bike-dispatch"
  image_parts  = split("/", var.image)
  secret_parts = split("/", var.quota_secret_version)

}

resource "terraform_data" "review" {

  lifecycle {

    precondition {
      condition     = var.image != "" && var.quota_secret_version != "" && var.maximum_workers >= var.minimum_workers
      error_message = "Choose a reviewed image, pinned quota secret and valid worker budget before enabling."

    }

    precondition {
      condition     = alltrue([for zone in var.zones : startswith(zone, "${var.region}-")])
      error_message = "Worker zones must belong to the selected region."

    }

    precondition {
      condition     = try(local.image_parts[1] == var.project_id && local.secret_parts[1] == var.project_id, false)
      error_message = "Use the reviewed project's image and quota secret."

    }


  }


}

resource "google_project_service" "apis" {

  for_each           = toset(["compute.googleapis.com", "pubsub.googleapis.com", "secretmanager.googleapis.com", "artifactregistry.googleapis.com", "monitoring.googleapis.com", "logging.googleapis.com", "iam.googleapis.com"])
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
  depends_on         = [terraform_data.review]

}

resource "google_service_account" "worker" {

  project      = var.project_id
  account_id   = "repaido-bike-dispatch"
  display_name = "Repaido ordered bike dispatch workers"
  depends_on   = [google_project_service.apis]

}

resource "google_pubsub_topic" "dispatch" {

  project = var.project_id
  name    = "${local.name}-v1"
  message_storage_policy {
    allowed_persistence_regions = [var.region]
  }

  depends_on = [google_project_service.apis]

}

resource "google_pubsub_subscription" "dispatch" {

  project                    = var.project_id
  name                       = "${local.name}-worker-v1"
  topic                      = google_pubsub_topic.dispatch.id
  enable_message_ordering    = true
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"
  expiration_policy {
    ttl = ""
  }

  retry_policy {
    minimum_backoff = "2s"
    maximum_backoff = "60s"

  }


}

resource "google_pubsub_topic_iam_member" "publish" {

  project = var.project_id
  topic   = google_pubsub_topic.dispatch.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.worker.email}"

}

resource "google_pubsub_subscription_iam_member" "subscribe" {

  for_each     = toset(["roles/pubsub.subscriber", "roles/pubsub.viewer"])
  project      = var.project_id
  subscription = google_pubsub_subscription.dispatch.name
  role         = each.key
  member       = "serviceAccount:${google_service_account.worker.email}"

}

resource "google_project_iam_member" "runtime" {

  for_each = toset(["roles/datastore.user", "roles/logging.logWriter"])
  project  = var.project_id
  role     = each.key
  member   = "serviceAccount:${google_service_account.worker.email}"

}

resource "google_secret_manager_secret_iam_member" "quota" {

  project   = var.project_id
  secret_id = local.secret_parts[3]
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"

}

resource "google_artifact_registry_repository_iam_member" "pull" {

  project    = var.project_id
  location   = replace(local.image_parts[0], "-docker.pkg.dev", "")
  repository = local.image_parts[2]
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.worker.email}"

}

resource "google_compute_network" "workers" {

  project                 = var.project_id
  name                    = "${local.name}-net"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]

}

resource "google_compute_subnetwork" "workers" {

  project                  = var.project_id
  name                     = "${local.name}-subnet"
  region                   = var.region
  ip_cidr_range            = "10.73.0.0/24"
  network                  = google_compute_network.workers.id
  private_ip_google_access = true

}

resource "google_compute_firewall" "probes" {

  project       = var.project_id
  name          = "${local.name}-probes"
  network       = google_compute_network.workers.id
  source_ranges = ["130.211.0.0/22", "35.191.0.0/16"]
  target_tags   = [local.name]
  allow {
    protocol = "tcp"
    ports    = ["9118"]

  }


}

data "google_compute_image" "cos" {
  family  = "cos-stable"
  project = "cos-cloud"

}

resource "google_compute_instance_template" "worker" {

  project      = var.project_id
  name_prefix  = "bike-worker-"
  machine_type = "e2-small"
  tags         = [local.name]
  disk {
    source_image = data.google_compute_image.cos.self_link
    disk_size_gb = 20
    disk_type    = "pd-balanced"
    auto_delete  = true
    boot         = true

  }

  network_interface {
    subnetwork = google_compute_subnetwork.workers.id
  }

  service_account {
    email  = google_service_account.worker.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]

  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true

  }

  metadata = {
    enable-oslogin = "TRUE", block-project-ssh-keys = "TRUE", google-logging-enabled = "true"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh.tftpl", {

    image  = var.image, registry = local.image_parts[0], project = var.project_id,
    topic  = google_pubsub_topic.dispatch.id, subscription = google_pubsub_subscription.dispatch.id,
    region = var.region, quota_secret_version = var.quota_secret_version

    }
  )
  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_pubsub_topic_iam_member.publish, google_pubsub_subscription_iam_member.subscribe,
    google_project_iam_member.runtime, google_secret_manager_secret_iam_member.quota,
  google_artifact_registry_repository_iam_member.pull]

}

resource "google_compute_health_check" "worker" {

  project             = var.project_id
  name                = "${local.name}-live"
  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 6
  http_health_check {
    port         = 9118
    request_path = "/livez"

  }


}

resource "google_compute_region_instance_group_manager" "workers" {

  project                   = var.project_id
  name                      = local.name
  region                    = var.region
  base_instance_name        = "bike-dispatch"
  distribution_policy_zones = var.zones
  target_size               = var.minimum_workers
  version {
    instance_template = google_compute_instance_template.worker.id
  }

  auto_healing_policies {
    health_check      = google_compute_health_check.worker.id
    initial_delay_sec = 300

  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 2
    max_unavailable_fixed = 0

  }

  lifecycle {
    ignore_changes = [target_size]
  }


}

resource "google_compute_region_autoscaler" "workers" {

  project = var.project_id
  name    = "${local.name}-scale"
  region  = var.region
  target  = google_compute_region_instance_group_manager.workers.id
  autoscaling_policy {

    min_replicas    = var.minimum_workers
    max_replicas    = var.maximum_workers
    cooldown_period = 120
    metric {

      name                       = "pubsub.googleapis.com/subscription/num_undelivered_messages"
      filter                     = "resource.type = \"pubsub_subscription\" AND resource.labels.subscription_id = \"${google_pubsub_subscription.dispatch.name}\""
      single_instance_assignment = var.events_per_worker

    }

    scale_in_control {
      max_scaled_in_replicas {
        fixed = 1
      }

      time_window_sec = 300

    }


  }


}

resource "google_monitoring_notification_channel" "operations" {

  count        = var.alert_email == "" ? 0 : 1
  project      = var.project_id
  display_name = "Repaido dispatch operations"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }


}

resource "google_monitoring_alert_policy" "age" {

  project               = var.project_id
  display_name          = "Bike dispatch oldest unacknowledged event"
  combiner              = "OR"
  notification_channels = google_monitoring_notification_channel.operations[*].name
  conditions {

    display_name = "Oldest event over one minute"
    condition_threshold {

      filter          = "resource.type = \"pubsub_subscription\" AND metric.type = \"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" AND resource.labels.subscription_id = \"${google_pubsub_subscription.dispatch.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 60
      duration        = "120s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"

      }

      trigger {
        count = 1
      }


    }


  }

  alert_strategy {
    auto_close = "3600s"
  }


}

output "worker_group" {
  value = google_compute_region_instance_group_manager.workers.id
}

output "subscription" {
  value = google_pubsub_subscription.dispatch.id
}

mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = { email = "bike-worker@repaido.iam.gserviceaccount.com" }
  }
  mock_resource "google_pubsub_topic" {
    defaults = { id = "projects/repaido/topics/repaido-bike-dispatch-v1" }
  }
  mock_resource "google_pubsub_subscription" {
    defaults = { id = "projects/repaido/subscriptions/repaido-bike-dispatch-worker-v1" }
  }
}

run "disabled_creates_nothing" {
  command = plan
  assert {
    condition     = output.worker_group == null && output.subscription == null && length(module.dispatch) == 0
    error_message = "Default configuration must create no infrastructure."
  }
}

run "reviewed_pool_has_bounded_recovery_and_no_public_workers" {
  command = apply
  module { source = "./pool" }
  variables {
    project_id           = "repaido"
    region               = "us-central1"
    zones                = ["us-central1-a", "us-central1-b"]
    image                = "us-central1-docker.pkg.dev/repaido/backend/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    quota_secret_version = "projects/repaido/secrets/bike-quota/versions/1"
    minimum_workers      = 2
    maximum_workers      = 16
    events_per_worker    = 32
    alert_email          = ""
  }
  assert {
    condition     = length(google_compute_instance_template.worker.network_interface[0].access_config) == 0 && google_compute_subnetwork.workers.private_ip_google_access
    error_message = "Worker VMs must be private and reach Google services through Private Google Access."
  }
  assert {
    condition     = length(google_compute_region_instance_group_manager.workers.distribution_policy_zones) == 2 && one(google_compute_region_instance_group_manager.workers.update_policy).max_unavailable_fixed == 0
    error_message = "Use two zones and preserve healthy workers during replacement."
  }
  assert {
    condition     = one(google_compute_region_autoscaler.workers.autoscaling_policy).min_replicas == 2 && one(google_compute_region_autoscaler.workers.autoscaling_policy).max_replicas == 16 && one(one(google_compute_region_autoscaler.workers.autoscaling_policy).metric).single_instance_assignment == 32
    error_message = "Backlog-based scaling must stay within the reviewed worker budget."
  }
  assert {
    condition     = google_pubsub_subscription.dispatch.enable_message_ordering && length(google_pubsub_subscription.dispatch.dead_letter_policy) == 0 && google_pubsub_subscription.dispatch.message_retention_duration == "604800s"
    error_message = "Retain ordered events for recovery; never discard reservation commands into an automatic dead letter path."
  }
  assert {
    condition     = one(google_compute_health_check.worker.http_health_check).request_path == "/livez" && one(google_compute_region_instance_group_manager.workers.auto_healing_policies).initial_delay_sec == 300
    error_message = "Healing must use the process watchdog with startup grace, avoiding a broker-outage restart storm."
  }
  assert {
    condition     = toset([for grant in google_project_iam_member.runtime : grant.role]) == toset(["roles/datastore.user", "roles/logging.logWriter"]) && google_secret_manager_secret_iam_member.quota.secret_id == "bike-quota"
    error_message = "Do not add project-wide Pub/Sub, secret-admin, owner or editor permissions."
  }
  assert {
    condition     = strcontains(google_compute_instance_template.worker.metadata_startup_script, "--read-only --cap-drop ALL") && strcontains(google_compute_instance_template.worker.metadata_startup_script, "Restart=always") && strcontains(google_compute_instance_template.worker.metadata_startup_script, "--time 60")
    error_message = "Container restarts, hardening and graceful subscription draining must remain configured."
  }
}

run "reject_mutable_image" {
  command = plan
  variables { image = "us-central1-docker.pkg.dev/repaido/backend/api:latest" }
  expect_failures = [var.image]
}

run "reject_mutable_quota_secret" {
  command = plan
  variables { quota_secret_version = "projects/repaido/secrets/bike-quota/versions/latest" }
  expect_failures = [var.quota_secret_version]
}

run "reject_unbounded_worker_budget" {
  command = plan
  variables { maximum_workers = 10000 }
  expect_failures = [var.maximum_workers]
}

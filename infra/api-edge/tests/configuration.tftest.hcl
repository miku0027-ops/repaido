mock_provider "google" {
  mock_resource "google_compute_global_address" {
    defaults = {
      address = "203.0.113.10"
    }
  }
}

run "private_preview_routes" {
  # Mock apply resolves computed IDs without provider authentication or cloud calls.
  command = apply

  assert {
    condition = alltrue([
      for backend in google_compute_backend_service.api :
      backend.enable_cdn == false && backend.load_balancing_scheme == "EXTERNAL_MANAGED" &&
      backend.security_policy == google_compute_security_policy.api.id
    ])
    error_message = "Both private API backends must disable CDN and share the edge security policy."
  }

  assert {
    condition = alltrue([
      for rule in google_compute_security_policy.api.rule :
      rule.priority == 2147483647 || rule.preview == true
    ])
    error_message = "WAF and IP throttling must default to preview."
  }

  assert {
    condition = toset(one(one(google_compute_url_map.https.path_matcher).path_rule).paths) == toset([
      for rewrite in jsondecode(file("${path.module}/../../firebase.json")).hosting.rewrites :
      replace(rewrite.source, "/**", "/*") if try(rewrite.run.serviceId, "") == "repaido-work-api"
    ])
    error_message = "Gateway work routes must cover the exact roots and descendants currently dispatched by Hosting."
  }

  assert {
    condition = (
      one(one(google_compute_url_map.https.path_matcher).path_rule).service == google_compute_backend_service.api["work"].id &&
      google_compute_url_map.https.default_service == google_compute_backend_service.api["main"].id &&
      one(google_compute_url_map.https.path_matcher).default_service == google_compute_backend_service.api["main"].id
    )
    error_message = "Work routes must target discovery while all other paths retain the main API fallback."
  }

  assert {
    condition = (
      google_compute_ssl_policy.api.min_tls_version == "TLS_1_2" &&
      google_compute_ssl_policy.api.profile == "RESTRICTED" &&
      one(google_compute_url_map.http_redirect.default_url_redirect).https_redirect == true &&
      one(google_compute_url_map.http_redirect.default_url_redirect).redirect_response_code == "PERMANENT_REDIRECT"
    )
    error_message = "TLS must require 1.2 and HTTP must preserve request methods when redirecting to HTTPS."
  }

  assert {
    condition = (
      one(google_compute_region_network_endpoint_group.api["main"].cloud_run).service == "repaido-api" &&
      one(google_compute_region_network_endpoint_group.api["work"].cloud_run).service == "repaido-work-api" &&
      alltrue([for neg in google_compute_region_network_endpoint_group.api : neg.region == "us-central1"])
    )
    error_message = "Only the existing public main/work services may be connected; never the private dispatch worker."
  }

  assert {
    condition     = output.cpanel_a_record.name == "api.repaido.com" && output.cpanel_a_record.value == "203.0.113.10"
    error_message = "The cPanel output must describe the dedicated API A record."
  }
}

run "reject_url_as_domain" {
  command = plan
  variables {
    domain = "https://api.repaido.com/api"
  }
  expect_failures = [var.domain]
}

run "reject_invalid_project" {
  command = plan
  variables {
    project_id = "projects/repaido"
  }
  expect_failures = [var.project_id]
}

run "reject_fractional_ip_rate" {
  command = plan
  variables {
    rate_limit_count = 1.5
  }
  expect_failures = [var.rate_limit_count]
}

run "reject_unsupported_rate_window" {
  command = plan
  variables {
    rate_limit_interval_seconds = 17
  }
  expect_failures = [var.rate_limit_interval_seconds]
}

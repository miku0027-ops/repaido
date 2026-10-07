locals {
  services = {
    main = var.main_service_name
    work = var.work_service_name
  }

  # Exact roots and descendants match current firebase.json Hosting dispatch.
  # The load balancer leaves /api intact; both apps strip it internally.
  work_paths = [
    "/api/repaidians/work",
    "/api/repaidians/work/*",
    "/api/repaidians/companies",
    "/api/repaidians/companies/*",
    "/api/repaidians/placements",
    "/api/repaidians/placements/*",
  ]
}

resource "google_compute_global_address" "api" {
  name         = "${var.name_prefix}-ip"
  project      = var.project_id
  address_type = "EXTERNAL"
  ip_version   = "IPV4"
  # Global external addresses use Premium tier; the forwarding rules state it explicitly.
}

resource "google_compute_region_network_endpoint_group" "api" {
  for_each              = local.services
  name                  = "${var.name_prefix}-${each.key}-neg"
  project               = var.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value
  }
}

resource "google_compute_security_policy" "api" {
  name        = "${var.name_prefix}-armor"
  project     = var.project_id
  type        = "CLOUD_ARMOR"
  description = "Repaido API WAF and IP abuse controls; preview by default."

  advanced_options_config {
    json_parsing = "STANDARD"
    log_level    = "NORMAL"
  }

  rule {
    action      = "deny(403)"
    priority    = 1000
    preview     = var.security_rules_preview
    description = "SQL injection signatures, sensitivity one."
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 1001
    preview     = var.security_rules_preview
    description = "Cross-site scripting signatures, sensitivity one."
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    action      = "throttle"
    priority    = 2000
    preview     = var.security_rules_preview
    description = "Source-IP throttle; tune for shared mobile carrier addresses."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = var.rate_limit_count
        interval_sec = var.rate_limit_interval_seconds
      }
    }
  }

  rule {
    action      = "allow"
    priority    = 2147483647
    description = "Default allow; application authentication still applies."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}

resource "google_compute_backend_service" "api" {
  for_each              = local.services
  name                  = "${var.name_prefix}-${each.key}-backend"
  project               = var.project_id
  protocol              = "HTTP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = false
  security_policy       = google_compute_security_policy.api.id

  backend {
    group = google_compute_region_network_endpoint_group.api[each.key].id
    # No health_checks, timeout_sec or balancing_mode: unsupported for serverless NEGs.
  }

  log_config {
    enable      = true
    sample_rate = var.log_sample_rate
  }
}

resource "google_compute_url_map" "https" {
  name            = "${var.name_prefix}-routes"
  project         = var.project_id
  default_service = google_compute_backend_service.api["main"].id

  host_rule {
    hosts        = [var.domain]
    path_matcher = "repaido-api"
  }

  path_matcher {
    name            = "repaido-api"
    default_service = google_compute_backend_service.api["main"].id
    path_rule {
      paths   = local.work_paths
      service = google_compute_backend_service.api["work"].id
    }
  }

  # GCP validates representative routing during creation/update as well.
  dynamic "test" {
    for_each = toset([
      "/api/repaidians/work", "/api/repaidians/work/jobs",
      "/api/repaidians/companies", "/api/repaidians/companies/example/jobs",
      "/api/repaidians/placements", "/api/repaidians/placements/example",
    ])
    content {
      host    = var.domain
      path    = test.value
      service = google_compute_backend_service.api["work"].id
    }
  }

  test {
    host    = var.domain
    path    = "/api/repaidians/state"
    service = google_compute_backend_service.api["main"].id
  }

  test {
    host    = var.domain
    path    = "/api/health"
    service = google_compute_backend_service.api["main"].id
  }

  dynamic "test" {
    for_each = toset([
      "/api/repaidians/workshop", "/api/repaidians/companies-other", "/api/repaidians/placements-other",
    ])
    content {
      host    = var.domain
      path    = test.value
      service = google_compute_backend_service.api["main"].id
    }
  }
}

resource "google_compute_managed_ssl_certificate" "api" {
  name    = "${var.name_prefix}-cert-${substr(sha256(var.domain), 0, 8)}"
  project = var.project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_ssl_policy" "api" {
  name            = "${var.name_prefix}-tls"
  project         = var.project_id
  profile         = "RESTRICTED"
  min_tls_version = "TLS_1_2"
}

resource "google_compute_target_https_proxy" "api" {
  name             = "${var.name_prefix}-https"
  project          = var.project_id
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.api.id]
  ssl_policy       = google_compute_ssl_policy.api.id
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name_prefix}-https"
  project               = var.project_id
  target                = google_compute_target_https_proxy.api.id
  ip_address            = google_compute_global_address.api.address
  ip_protocol           = "TCP"
  port_range            = "443"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

resource "google_compute_url_map" "http_redirect" {
  name    = "${var.name_prefix}-http-redirect"
  project = var.project_id

  default_url_redirect {
    host_redirect          = var.domain
    https_redirect         = true
    redirect_response_code = "PERMANENT_REDIRECT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${var.name_prefix}-http"
  project = var.project_id
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "${var.name_prefix}-http"
  project               = var.project_id
  target                = google_compute_target_http_proxy.redirect.id
  ip_address            = google_compute_global_address.api.address
  ip_protocol           = "TCP"
  port_range            = "80"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  network_tier          = "PREMIUM"
}

output "cpanel_a_record" {
  description = "Review in cPanel Zone Editor for the authoritative domain; do not alter apex or mail records."
  value = {
    type  = "A"
    name  = var.domain
    value = google_compute_global_address.api.address
    ttl   = 300
  }
}

output "api_origin" {
  description = "Use only after DNS, certificate ACTIVE and authenticated route validation complete."
  value       = "https://${var.domain}"
}

output "certificate_readiness" {
  description = "Certificate provisioning is asynchronous; successful Terraform apply does not mean HTTPS is ready."
  value = {
    name = google_compute_managed_ssl_certificate.api.name
    check_command = join(" ", [
      "gcloud compute ssl-certificates describe", google_compute_managed_ssl_certificate.api.name,
      "--project=${var.project_id}", "--global", "--format='value(managed.status)'",
    ])
    required_status = "ACTIVE"
    prerequisite    = "Authoritative public A record must resolve to the reserved IP; remove conflicting api A/AAAA records and review CAA if provisioning stalls."
  }
}

output "security_preview" {
  description = "Preview WAF/throttle rules log matches but do not reject requests."
  value = {
    policy         = google_compute_security_policy.api.name
    preview        = var.security_rules_preview
    rate_count     = var.rate_limit_count
    interval_sec   = var.rate_limit_interval_seconds
    scope          = "Source IP, separately per backend service; not a distributed account quota."
    request_sample = var.log_sample_rate
  }
}

output "cutover_checklist" {
  description = "Mandatory manual deployment stages; this module does not perform them."
  value = [
    "In cPanel authoritative Zone Editor, publish the output api A record without changing mail or apex records.",
    "Wait for managed certificate ACTIVE; test TLS, preserved /api paths, main/work roots and descendants, auth, Range, webhooks and native clients.",
    "Migrate generic VITE_API_BASE_URL and same-origin community/work callers; current Firebase Hosting /api rewrites and older APK run.app callers bypass this policy.",
    "Review sampled preview matches and carrier/shared-IP false positives before setting security_rules_preview=false and tuning thresholds.",
    "After all supported client paths are on the edge, separately restrict main/work Cloud Run ingress to internal-and-cloud-load-balancing and verify direct external origins fail; preserve private Scheduler access.",
    "Keep authenticated backend authorization and private media policies; CDN is intentionally disabled.",
  ]
}

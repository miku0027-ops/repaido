variable "project_id" {
  description = "Existing GCP project containing both Cloud Run services."
  type        = string
  default     = "repaido"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "Use a 6-30 character GCP project ID, starting with a letter and ending with a letter or number."
  }
}

variable "domain" {
  description = "Dedicated API hostname managed in cPanel DNS; no scheme, path or wildcard."
  type        = string
  default     = "api.repaido.com"

  validation {
    condition = length(var.domain) <= 253 && can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain)) && alltrue([
      for label in split(".", var.domain) : length(label) <= 63
    ])
    error_message = "Use a lowercase fully qualified DNS hostname with valid labels; do not include HTTPS, paths or a wildcard."
  }
}

variable "region" {
  description = "Existing Cloud Run services and serverless NEGs must use this same region."
  type        = string
  default     = "us-central1"

  validation {
    condition     = can(regex("^[a-z]+(-[a-z]+)+[0-9]$", var.region))
    error_message = "Use a GCP region such as us-central1."
  }
}

variable "name_prefix" {
  description = "Unique prefix for newly managed load-balancer resources."
  type        = string
  default     = "repaido-api-edge"

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,28}[a-z0-9])?$", var.name_prefix))
    error_message = "Use a lowercase resource prefix of 1-30 characters starting with a letter."
  }
}

variable "main_service_name" {
  description = "Existing main Cloud Run service. This module does not manage its IAM or ingress."
  type        = string
  default     = "repaido-api"

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$", var.main_service_name))
    error_message = "Use a Cloud Run service name of 1-49 lowercase letters, numbers and hyphens."
  }
}

variable "work_service_name" {
  description = "Existing work discovery Cloud Run service; never the private dispatch worker."
  type        = string
  default     = "repaido-work-api"

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$", var.work_service_name))
    error_message = "Use a Cloud Run service name of 1-49 lowercase letters, numbers and hyphens."
  }
}

variable "security_rules_preview" {
  description = "Keep WAF and IP throttling in preview until real traffic and mobile NAT false positives are reviewed."
  type        = bool
  default     = true
}

variable "rate_limit_count" {
  description = "Preview requests per source IP per backend service in each interval; not an account-wide quota."
  type        = number
  default     = 600

  validation {
    condition     = var.rate_limit_count == floor(var.rate_limit_count) && var.rate_limit_count >= 10 && var.rate_limit_count <= 100000
    error_message = "Use a whole-number IP rate threshold between 10 and 100000 requests."
  }
}

variable "rate_limit_interval_seconds" {
  description = "Supported Cloud Armor throttle window in seconds."
  type        = number
  default     = 60

  validation {
    condition     = contains([10, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 2700, 3600], var.rate_limit_interval_seconds)
    error_message = "Use one of the supported Cloud Armor interval values listed in variables.tf."
  }
}

variable "log_sample_rate" {
  description = "Load-balancer request log sample ratio; logs are required to assess preview rule matches."
  type        = number
  default     = 0.1

  validation {
    condition     = var.log_sample_rate > 0 && var.log_sample_rate <= 1
    error_message = "Use a request logging sample ratio greater than zero and at most one."
  }
}

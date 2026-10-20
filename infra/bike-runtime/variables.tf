variable "enabled" {
  type        = bool
  default     = false
  description = "Explicit opt-in. False creates no infrastructure."

}

variable "project_id" {
  type    = string
  default = "repaido"

}

variable "region" {
  type    = string
  default = "us-central1"

}

variable "zones" {
  type    = list(string)
  default = ["us-central1-a", "us-central1-b"]
  validation {
    condition     = length(distinct(var.zones)) == 2
    error_message = "Use two distinct zones in the selected region."

  }


}

variable "image" {
  type        = string
  description = "Reviewed existing Artifact Registry image pinned by SHA256 digest."
  default     = ""
  validation {
    condition     = var.image == "" || can(regex("^[a-z]+-[a-z0-9-]+-docker[.]pkg[.]dev/[a-z0-9-]+/[a-z0-9_-]+/[a-z0-9_-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "Pin a reviewed regional Artifact Registry image by digest."

  }


}

variable "quota_secret_version" {
  type        = string
  default     = ""
  description = "Existing Secret Manager resource pinned to the same numeric version used by the API. No secret value."
  validation {
    condition     = var.quota_secret_version == "" || can(regex("^projects/[a-z0-9-]+/secrets/[A-Za-z0-9_-]+/versions/[1-9][0-9]*$", var.quota_secret_version))
    error_message = "Use a pinned numeric Secret Manager version resource."

  }


}

variable "minimum_workers" {
  type    = number
  default = 2
  validation {
    condition     = var.minimum_workers == floor(var.minimum_workers) && var.minimum_workers >= 2 && var.minimum_workers <= 32
    error_message = "Keep 2-32 minimum workers for zone redundancy."

  }


}

variable "maximum_workers" {
  type    = number
  default = 16
  validation {
    condition     = var.maximum_workers == floor(var.maximum_workers) && var.maximum_workers >= 2 && var.maximum_workers <= 64
    error_message = "Set a reviewed 2-64 worker capacity ceiling."

  }


}

variable "events_per_worker" {
  type    = number
  default = 32
  validation {
    condition     = var.events_per_worker >= 1 && var.events_per_worker <= 1000
    error_message = "Choose a measured backlog target between 1 and 1000 events per worker."

  }


}

variable "alert_email" {
  type        = string
  default     = ""
  description = "Optional reviewed operations alert recipient; blank leaves alerts visible only in Monitoring."

}

variable "existing_notification_channels" {
  type        = list(string)
  default     = []
  description = "Existing reviewed Monitoring channel references to preserve when adopting the alert; channels remain externally owned."
}

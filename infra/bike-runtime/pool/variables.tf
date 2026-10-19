variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "zones" {
  type = list(string)
}

variable "image" {
  type = string
}

variable "quota_secret_version" {
  type = string
}

variable "minimum_workers" {
  type = number
}

variable "maximum_workers" {
  type = number
}

variable "events_per_worker" {
  type = number
}

variable "alert_email" {
  type = string
}

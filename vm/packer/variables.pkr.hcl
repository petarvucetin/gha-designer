# vm/packer/variables.pkr.hcl
variable "iso_url" {
  type = string
  # Generic (non-point-release) filename 404s once a point release supersedes it;
  # keep this pinned to the current 24.04.x point release published at releases.ubuntu.com/24.04/.
  default = "https://releases.ubuntu.com/24.04/ubuntu-24.04.4-live-server-amd64.iso"
}
variable "iso_checksum" {
  type = string
  # Update to the current 24.04.x point-release checksum from releases.ubuntu.com/24.04/SHA256SUMS
  default = "file:https://releases.ubuntu.com/24.04/SHA256SUMS"
}
variable "cpus" {
  type    = number
  default = 4
}
variable "memory" {
  type    = number
  default = 8192
}
variable "disk_size" {
  type    = number
  default = 40960
}
variable "switch_name" {
  type    = string
  default = "Default Switch"
}

# vm/packer/ubuntu-runner.pkr.hcl
packer {
  required_plugins {
    hyperv = { source = "github.com/hashicorp/hyperv", version = ">= 1.1.0" }
  }
}

source "hyperv-iso" "ubuntu-runner" {
  iso_url            = var.iso_url
  iso_checksum       = var.iso_checksum
  cpus               = var.cpus
  memory             = var.memory
  disk_size          = var.disk_size
  switch_name        = var.switch_name
  generation         = 2
  enable_secure_boot = false
  http_directory     = "${path.root}/http" # serves build-time autoinstall user-data/meta-data
  boot_command       = ["<wait10>c<wait5>", "linux /casper/vmlinuz --- autoinstall ds='nocloud-net;s=http://{{.HTTPIP}}:{{.HTTPPort}}/'<enter><wait5>", "initrd /casper/initrd<enter><wait5>", "boot<enter>"]
  ssh_username       = "runner"
  ssh_password       = "runner" # autoinstall bootstrap creds; replaced by key on first run
  ssh_timeout        = "40m"
  shutdown_command   = "sudo shutdown -P now"
  output_directory   = "${path.root}/../output-hyperv"
}

build {
  sources = ["source.hyperv-iso.ubuntu-runner"]

  provisioner "file" {
    source      = "${path.root}/../toolset.yaml"
    destination = "/tmp/toolset.yaml"
  }
  provisioner "file" {
    source      = "${path.root}/../provision/"
    destination = "/tmp/provision"
  }
  provisioner "file" {
    source      = "${path.root}/../run/"
    destination = "/tmp/run"
  }
  provisioner "shell" {
    inline = [
      "chmod +x /tmp/provision/*.sh",
      "sudo bash /tmp/provision/install-toolset.sh /tmp/toolset.yaml",
      "sudo mkdir -p /opt/vm/run",
      "sudo cp /tmp/run/*.sh /opt/vm/run/",
      "sudo chmod +x /opt/vm/run/*.sh",
    ]
  }
}

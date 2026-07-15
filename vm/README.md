# vm/ — Faithful full-VM act runner (Phase 1)

Builds an Ubuntu 24.04 VM provisioned like a GitHub `ubuntu-latest` runner (practical
subset), with pinned `act` v0.2.89, that runs workflows in two modes:
- **self-hosted** — steps run on the VM's real OS (max fidelity: systemd, nested virt)
- **container** — each job runs in a Docker container on the VM (concurrency + isolation)

## Prerequisites
- Hyper-V enabled (admin): `Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All`
- Packer: `winget install --id HashiCorp.Packer -e`

## Build the golden image
```powershell
pwsh vm/hyperv/build-image.ps1     # -> vm/output-hyperv/*.vhdx
```

Add `-DryRun` to print the `packer build` command that would run, without invoking
`packer init`/`validate`/`build`:
```powershell
pwsh vm/hyperv/build-image.ps1 -DryRun
```

## Run a workflow (manual, Phase 1)
```powershell
. vm/hyperv/vm-lib.ps1
New-RunnerVm -VhdxPath vm/output-hyperv/<image>.vhdx -PubKeyPath $HOME/.ssh/id_ed25519.pub
Start-RunnerVm
$ip = Get-RunnerVmIp
# copy your workspace to the VM, then over SSH:
#   ACT_SECRETS='' bash /opt/vm/run/act-run.sh --workspace ~/ws --mode self-hosted
```

Phase 2 wires this into the Designer's Run ▶ as a `vm` engine. The toolset is defined
once in `vm/toolset.yaml` and reused by the container image build in Phase 3.

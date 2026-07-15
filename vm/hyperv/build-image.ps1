# vm/hyperv/build-image.ps1
# Orchestrates `packer init` / `validate` / `build` for the Hyper-V golden image.
# -DryRun prints the packer command that would run and exits 0 without invoking packer.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$packerDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'packer'
$cmd = "packer build $packerDir"
if ($DryRun) { Write-Output $cmd; return }
& packer init $packerDir
if ($LASTEXITCODE -ne 0) { throw "packer init failed" }
& packer validate $packerDir
if ($LASTEXITCODE -ne 0) { throw "packer validate failed" }
& packer build $packerDir
if ($LASTEXITCODE -ne 0) { throw "packer build failed" }
Write-Host "Golden image built under vm/output-hyperv/" -ForegroundColor Green

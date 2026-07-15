# vm/tests/build-image.tests.ps1
$ErrorActionPreference = 'Stop'
$out = pwsh -File "$PSScriptRoot/../hyperv/build-image.ps1" -DryRun
if ("$out" -match 'packer build' -and "$out" -match 'vm[/\\]packer') { Write-Host 'build-image.tests.ps1: PASS' }
else { Write-Host "build-image.tests.ps1: FAIL got: $out"; exit 1 }

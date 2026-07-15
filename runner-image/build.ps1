# Build the local act runner image in Podman (Windows/PowerShell).
#   pwsh runner-image/build.ps1            # builds localhost/act-runner:latest
#   pwsh runner-image/build.ps1 -Tag foo   # custom tag
param([string]$Tag = 'localhost/act-runner:latest')
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

podman build -t $Tag -f (Join-Path $here 'Containerfile') $here
if ($LASTEXITCODE -ne 0) { throw "podman build failed ($LASTEXITCODE)" }

Write-Host "`nBuilt $Tag" -ForegroundColor Green
podman images $Tag
Write-Host "`nUse it in the designer: Run > engine Podman > runner image 'custom...' > '$Tag', leave 'pull image before run' unchecked."
Write-Host "Or on the CLI:  act -P ubuntu-latest=$Tag --pull=false"

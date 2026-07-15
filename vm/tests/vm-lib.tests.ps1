# vm/tests/vm-lib.tests.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../hyperv/vm-lib.ps1"
$fail = 0
function Assert-Eq($a, $b, $msg) { if ($a -ne $b) { Write-Host "FAIL: $msg (got '$a', want '$b')"; $script:fail = 1 } }

Assert-Eq (Get-RunnerSshTarget -User 'runner' -Ip '192.168.1.5') 'runner@192.168.1.5' 'ssh target format'

Assert-Eq (Select-RunnerIp -Candidates @('169.254.1.2','172.17.0.1','192.168.1.50','fe80::1')) '192.168.1.50' 'ip selection skips docker0/link-local'

$pub = New-TemporaryFile; Set-Content $pub 'ssh-ed25519 AAAAKEY test'
$args = New-SeedIsoArgs -PubKeyPath $pub -OutDir ([System.IO.Path]::GetTempPath())
$ud = Get-Content $args.UserData -Raw
if ($ud -notmatch 'ssh-ed25519 AAAAKEY test') { Write-Host 'FAIL: pubkey not substituted'; $fail = 1 }
if ($ud -match '__SSH_PUBKEY__') { Write-Host 'FAIL: placeholder still present'; $fail = 1 }

if ($fail -eq 0) { Write-Host 'vm-lib.tests.ps1: PASS' } else { Write-Host 'vm-lib.tests.ps1: FAIL'; exit 1 }

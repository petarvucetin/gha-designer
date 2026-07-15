# vm/hyperv/vm-lib.ps1
# Hyper-V implementation of the VM lifecycle contract. Pure-logic functions are
# unit-tested on the host; Hyper-V operations are exercised by the Phase 1 smoke.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RunnerSshTarget {
  param([Parameter(Mandatory)][string]$User, [Parameter(Mandatory)][string]$Ip)
  return "$User@$Ip"
}

function New-SeedIsoArgs {
  param([Parameter(Mandatory)][string]$PubKeyPath, [Parameter(Mandatory)][string]$OutDir)
  $pub = (Get-Content -Raw $PubKeyPath).Trim()
  $tmplDir = Join-Path $PSScriptRoot '..' 'cloud-init'
  $userData = Join-Path $OutDir 'user-data'
  (Get-Content -Raw (Join-Path $tmplDir 'user-data')).Replace('__SSH_PUBKEY__', $pub) | Set-Content -NoNewline $userData
  Copy-Item (Join-Path $tmplDir 'meta-data') (Join-Path $OutDir 'meta-data') -Force
  return @{ UserData = $userData; MetaData = (Join-Path $OutDir 'meta-data') }
}

function New-SeedDisk {
  # Build a cloud-init NoCloud seed as a small FAT VHDX labeled CIDATA. Uses only
  # built-in PowerShell (no oscdimg/Windows ADK). cloud-init's NoCloud datasource
  # discovers the seed by the CIDATA filesystem label on any attached block device.
  param([Parameter(Mandatory)][string]$PubKeyPath, [Parameter(Mandatory)][string]$OutDir)
  $a = New-SeedIsoArgs -PubKeyPath $PubKeyPath -OutDir $OutDir   # writes user-data + meta-data
  $vhd = Join-Path $OutDir 'seed.vhdx'
  if (Test-Path $vhd) { Remove-Item $vhd -Force }
  New-VHD -Path $vhd -SizeBytes 64MB -Dynamic | Out-Null
  Mount-VHD -Path $vhd
  try {
    $disk = Get-VHD -Path $vhd | Get-Disk
    Initialize-Disk -Number $disk.Number -PartitionStyle MBR | Out-Null
    $part = New-Partition -DiskNumber $disk.Number -UseMaximumSize -AssignDriveLetter
    Format-Volume -DriveLetter $part.DriveLetter -FileSystem FAT -NewFileSystemLabel CIDATA -Confirm:$false | Out-Null
    $dst = "$($part.DriveLetter):\"
    Copy-Item $a.UserData (Join-Path $dst 'user-data') -Force
    Copy-Item $a.MetaData (Join-Path $dst 'meta-data') -Force
  } finally {
    Dismount-VHD -Path $vhd
  }
  return $vhd
}

function New-RunnerVm {
  param([string]$Name = 'gha-runner', [Parameter(Mandatory)][string]$VhdxPath, [string]$Switch = 'Default Switch',
        [int]$Cpus = 8, [long]$MemoryBytes = 16GB, [Parameter(Mandatory)][string]$PubKeyPath)
  # Differencing disk off the golden VHDX so each VM boots fast and leaves the image pristine.
  $diff = Join-Path (Split-Path $VhdxPath) "$Name.avhdx"
  New-VHD -Path $diff -ParentPath $VhdxPath -Differencing | Out-Null
  New-VM -Name $Name -MemoryStartupBytes $MemoryBytes -VHDPath $diff -Generation 2 -SwitchName $Switch | Out-Null
  Set-VMProcessor -VMName $Name -Count $Cpus -ExposeVirtualizationExtensions $true
  Set-VMFirmware -VMName $Name -EnableSecureBoot Off
  # Attach the cloud-init NoCloud seed (FAT VHDX labeled CIDATA) so the instance
  # injects the SSH key + disables password auth on first boot.
  $seedDir = Join-Path (Split-Path $VhdxPath) "$Name-seed"
  New-Item -ItemType Directory -Force -Path $seedDir | Out-Null
  $seed = New-SeedDisk -PubKeyPath $PubKeyPath -OutDir $seedDir
  Add-VMHardDiskDrive -VMName $Name -Path $seed
  return $Name
}

function Start-RunnerVm    { param([string]$Name='gha-runner') Start-VM -Name $Name | Out-Null }
function Stop-RunnerVm     { param([string]$Name='gha-runner') Stop-VM -Name $Name -Force | Out-Null }
function Get-RunnerVmStatus{ param([string]$Name='gha-runner') (Get-VM -Name $Name).State.ToString() }
function Select-RunnerIp {
  param([string[]]$Candidates)
  return $Candidates |
    Where-Object { $_ -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$' } |
    Where-Object { $_ -notmatch '^(169\.254\.|172\.17\.|127\.)' } |
    Select-Object -First 1
}
function Get-RunnerVmIp {
  param([string]$Name='gha-runner')
  Select-RunnerIp -Candidates ((Get-VMNetworkAdapter -VMName $Name).IPAddresses)
}

# Task 8 — real-build smoke test (evidence)

Verified on Windows 11 + Hyper-V (admin), 2026-07-10, against a live Ubuntu 24.04.4 VM.

## Result: PASS in both modes, fully offline (no github.com)

act 0.2.89 ran the probe workflow (`runs-on: ubuntu-latest`, echo + node/git/bash) via
`/opt/vm/run/act-run.sh` on the VM:

| Mode | Steps executed in | Proof | Result |
|---|---|---|---|
| `-self-hosted` | the VM's real OS | `git version 2.43.0`, `node v20.20.2` | 🏁 Job succeeded, exit 0 |
| container | `localhost/act-runner:latest` | `git version 2.39.5` (image's Debian git ≠ host 2.43.0), `Start image=… forcePull=false` | 🏁 Job succeeded, exit 0 |

The differing git versions prove self-hosted ran on the VM OS while container mode ran inside
the image. Both cleared: C1 (unattended autoinstall), I1 (`act-run.sh` at `/opt/vm/run`),
I2 (`runner` in `docker` group — container mode used the socket without sudo).

## VM toolchain (provisioned like a GitHub ubuntu-latest runner)
act 0.2.89 · node v20.20.2 · Python 3.12.3 · git 2.43.0 · gh 2.96.0 · Docker 29.6.1 ·
`runner` groups: sudo, docker.

## How it was built (and an important caveat)

1. `packer build` (hyperv-iso + the `vm/packer/http/` autoinstall doc) — **the unattended OS
   install worked**: ISO fetched, `boot_command` accepted, subiquity installed 24.04.4 headless.
2. **KVP caveat (known Hyper-V/Packer limitation on the "Default Switch"):** after install,
   `Get-VMNetworkAdapter … IPAddresses` returned empty because the guest's Hyper-V KVP daemon
   wasn't publishing the IP, so Packer's `hyperv-iso` builder could not discover the VM to run
   its `provisioner` blocks (it sat at "Waiting for SSH" though SSH was reachable at the guest IP).
   - Workaround used here: provision the same `install-toolset.sh` over SSH directly (see
     `scratchpad/provision-vm.py` pattern). SSH login `runner`/`runner` (throwaway dev cred).
   - Proper fixes for the automated Packer flow (future work): install
     `linux-cloud-tools-$(uname -r)` (kernel-matched, not the `-virtual` meta) so KVP reports the
     IP; or build against a non-NAT external/internal switch; or use an Ubuntu cloud image + a
     NoCloud seed instead of ISO autoinstall.

## Not exercised (production-hardening, still UNVERIFIED)
- **C2** cloud-init seed-ISO key injection (`New-SeedIso`/oscdimg): verification here used
  password SSH, not per-instance SSH-key injection. The oscdimg/ADK path remains untested.
- Golden-image **export** (Packer's export step) did not run (build stopped at the KVP gate).

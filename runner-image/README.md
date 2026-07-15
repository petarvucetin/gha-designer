# Local act runner image

A small Podman/Docker image for running workflows locally with
[nektos/act](https://github.com/nektos/act), as an alternative to downloading the
~1.6 GB `catthehacker/ubuntu:act-latest`. This one is ~315 MB.

It is `node:20-bookworm-slim` plus the tools workflows usually assume:
Node.js 20 (required — `actions/checkout` and most marketplace actions are JavaScript
and run on node), `git`, `bash`, `curl`/`wget`, `jq`, `unzip`/`zip`, `sudo`, `openssh-client`.
The base is Debian, so `apt-get install` in a `run:` step works like it does under catthehacker.

## Build

```powershell
pwsh runner-image/build.ps1            # -> localhost/act-runner:latest
```

```bash
./runner-image/build.sh                # -> localhost/act-runner:latest
# TAG=localhost/act-runner:1 ./runner-image/build.sh   # custom tag
```

## Use it

**In the designer:** Run ▶ → engine **Podman** → **runner image** → `custom…` →
type `localhost/act-runner:latest` → leave **"pull image before run" unchecked**.

**On the CLI** (the exact flags the designer emits):

```
act -P ubuntu-latest=localhost/act-runner:latest --pull=false
```

`-P ubuntu-latest=<image>` maps the runner label your workflow requests to this image;
`--pull=false` tells act to use the copy already in Podman rather than fetching one.
Reference the image by the name `podman images` shows (locally built images are
`localhost/<name>:<tag>`); with pull left on, act would try to fetch it from a registry
and fail.

## Alpine variant

`Containerfile.alpine` builds `localhost/act-runner-alpine:latest` (~98 MB). Alpine is the
awkward case for act, so it needs care:

```bash
podman build -t localhost/act-runner-alpine:latest -f runner-image/Containerfile.alpine runner-image
```

What to know (all verified with act + Podman):

- **bash is mandatory.** act runs every `run:` step as `bash -e`, and Alpine ships only
  busybox `sh`. A bare `alpine` image fails immediately: `executable file 'bash' not found
  in $PATH` (exit 127). The Containerfile installs `bash`.
- **Pure-JavaScript actions work.** Alpine's musl `nodejs` runs node20 JS actions fine —
  `actions/checkout@v4` succeeds on this image.
- **glibc-only binaries may not.** Alpine is musl, not glibc. Actions that download a
  *prebuilt glibc binary* (many `setup-*` actions fetch glibc toolchains — setup-python's
  CPython, some setup-node builds) can fail even with the `gcompat`/`libstdc++` shims
  included here, which cover some but not all glibc binaries. If a workflow leans on those,
  use the Debian-slim image (or catthehacker) instead.
- **busybox ≠ GNU.** `coreutils` is installed so scripts that rely on GNU flags behave.

Once you add bash + node + the compat packages, the Alpine image isn't dramatically
smaller than the Debian-slim one (98 MB vs 315 MB) — reach for Alpine when you specifically
need a musl environment, otherwise the default image is the safer choice.

## Extending it

Need more tooling (python, a specific CLI, a language toolchain)? Add it to the
`Containerfile`'s `apt-get install` line (or a new `RUN`) and rebuild. To start from the
full GitHub-runner environment instead, base it on catthehacker:
`FROM catthehacker/ubuntu:act-latest`.

## Verified

`act` ran a probe workflow (`runs-on: ubuntu-latest`) against this image on Podman with
`--pull=false`: engine selected via `npipe:////./pipe/podman-machine-default`,
`Start image=localhost/act-runner:latest` with `forcePull=false` (no download), and the
steps printed the marker, `node v20.20.2`, and `git 2.39.5` — job succeeded.

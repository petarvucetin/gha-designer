#!/usr/bin/env bash
# Build the local act runner image in Podman (bash / Git Bash / WSL).
#   ./runner-image/build.sh              # builds localhost/act-runner:latest
#   TAG=foo ./runner-image/build.sh      # custom tag
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tag="${TAG:-localhost/act-runner:latest}"

podman build -t "$tag" -f "$here/Containerfile" "$here"

echo
echo "Built $tag"
podman images "$tag"
echo
echo "Use it in the designer: Run > engine Podman > runner image 'custom...' > '$tag', leave 'pull image before run' unchecked."
echo "Or on the CLI:  act -P ubuntu-latest=$tag --pull=false"

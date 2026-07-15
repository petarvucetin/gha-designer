#!/usr/bin/env bash
# Installs the practical-subset toolset from vm/toolset.yaml onto the VM OS.
# Runs inside the VM (Ubuntu 24.04). Idempotent-ish; intended for Packer provisioning.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="${1:-$HERE/../toolset.yaml}"
export DEBIAN_FRONTEND=noninteractive

command -v yq >/dev/null 2>&1 || {
  # Pinned (was releases/latest/download) so builds are reproducible; bump deliberately.
  curl -fsSL https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64 -o /usr/local/bin/yq
  chmod +x /usr/local/bin/yq
}

apt-get update
mapfile -t APT < <(yq -r '.apt[]' "$MANIFEST")
apt-get install -y --no-install-recommends "${APT[@]}"

NODE_MAJOR="$(yq -r '.tools.node.version' "$MANIFEST")"
[ -n "$NODE_MAJOR" ] || { echo "yq: .tools.node.version empty" >&2; exit 1; }
curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
apt-get install -y nodejs

PY="$(yq -r '.tools.python.version' "$MANIFEST")"
[ -n "$PY" ] || { echo "yq: .tools.python.version empty" >&2; exit 1; }
apt-get install -y "python${PY}" "python${PY}-venv" python3-pip

# gh CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
apt-get update && apt-get install -y gh

# Docker (docker-ce + buildx + compose) when tools.docker == true
if [ "$(yq -r '.tools.docker' "$MANIFEST")" = "true" ]; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  # docker group exists only after docker-ce install; add the runner user now.
  usermod -aG docker runner
fi

ACT_VERSION="$(yq -r '.act.version' "$MANIFEST")"
[ -n "$ACT_VERSION" ] || { echo "yq: .act.version empty" >&2; exit 1; }
bash "$HERE/install-act.sh" "$ACT_VERSION"

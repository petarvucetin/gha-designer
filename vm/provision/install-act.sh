#!/usr/bin/env bash
# Installs a specific act release. The version is the single source of truth in
# vm/toolset.yaml (.act.version) and is passed in by install-toolset.sh.
#   install-act.sh <VERSION>            installs that version
#   install-act.sh --print-url <VERSION> prints the resolved URL and exits
set -euo pipefail
ACT_VERSION="${1:-}"
if [ "${1:-}" = "--print-url" ]; then ACT_VERSION="${2:?version required}"; fi
[ -n "$ACT_VERSION" ] || { echo "act version required (arg 1, or arg 2 with --print-url)" >&2; exit 2; }
url="https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz"
if [ "${1:-}" = "--print-url" ]; then echo "$url"; exit 0; fi
tmp="$(mktemp -d)"
curl -fsSL "$url" -o "$tmp/act.tgz"
tar -xzf "$tmp/act.tgz" -C "$tmp" act
install -m 0755 "$tmp/act" /usr/local/bin/act
rm -rf "$tmp"
act --version

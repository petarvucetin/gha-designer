#!/usr/bin/env bash
# In-VM wrapper around act. Assembles a faithful, non-interactive act invocation.
# Secrets: pass NAMES via $ACT_SECRETS (space-separated); values must already be in
# the environment. We emit `-s NAME` (no value) so act reads the value from env —
# values never touch argv or disk.
set -euo pipefail

workspace="" mode="" image="localhost/act-runner:latest" event="" event_name="" artifact="" workflow="" job="" pull="false" print_only=0
inputs=() vars=() labels=()
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) workspace="$2"; shift 2;;
    --mode) mode="$2"; shift 2;;
    --image) image="$2"; shift 2;;
    --event) event="$2"; shift 2;;
    --event-name) event_name="$2"; shift 2;;
    --job) job="$2"; shift 2;;
    --input) inputs+=("$2"); shift 2;;
    --var) vars+=("$2"); shift 2;;
    --pull) pull="$2"; shift 2;;
    --artifact-path) artifact="$2"; shift 2;;
    --workflow) workflow="$2"; shift 2;;
    --label) labels+=("$2"); shift 2;;
    --print-cmd) print_only=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$workspace" ] || { echo "--workspace required" >&2; exit 2; }
[ -n "$mode" ] || { echo "--mode required" >&2; exit 2; }

case "$mode" in
  self-hosted) platform="-self-hosted";;
  container)   platform="$image";;
  *) echo "--mode must be self-hosted|container" >&2; exit 2;;
esac

# A target workflow scopes act to that single file (act accepts a file path to
# --workflows); omitted, it falls back to the whole directory (runs every workflow).
cmd=(act)
[ -n "$event_name" ] && cmd+=("$event_name")
if [ -n "$workflow" ]; then
  cmd+=(--workflows "$workspace/$workflow")
else
  cmd+=(--workflows "$workspace/.github/workflows")
fi
cmd+=(--json "--pull=$pull")
[ "${#labels[@]}" -eq 0 ] && labels=(ubuntu-latest)
for lbl in "${labels[@]}"; do cmd+=(-P "$lbl=$platform"); done
[ -n "$job" ] && cmd+=(-j "$job")
for kv in ${inputs[@]+"${inputs[@]}"}; do cmd+=(--input "$kv"); done
for kv in ${vars[@]+"${vars[@]}"}; do cmd+=(--var "$kv"); done
[ -n "$event" ] && cmd+=(-e "$event")
[ -n "$artifact" ] && cmd+=(--artifact-server-path "$artifact")
for name in ${ACT_SECRETS:-}; do cmd+=(-s "$name"); done

if [ "$print_only" -eq 1 ]; then printf '%s ' "${cmd[@]}"; echo; exit 0; fi

# Real run: act needs a git repo or it spams git-ref errors (project invariant).
if [ ! -d "$workspace/.git" ]; then git -C "$workspace" init -q && git -C "$workspace" add -A && git -C "$workspace" -c user.email=act@local -c user.name=act commit -qm "act workspace" || true; fi
# The artifact server needs its directory to exist before act starts it.
[ -n "$artifact" ] && mkdir -p "$artifact"
cd "$workspace"
exec "${cmd[@]}"

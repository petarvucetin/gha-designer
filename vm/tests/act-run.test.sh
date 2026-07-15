#!/usr/bin/env bash
set -u
SCRIPT="$(dirname "$0")/../run/act-run.sh"
fail=0
assert_contains() { case "$1" in *"$2"*) ;; *) echo "MISSING: '$2' in: $1"; fail=1;; esac; }
assert_absent()   { case "$1" in *"$2"*) echo "PRESENT (should be absent): '$2'"; fail=1;; *) ;; esac; }

out="$(bash "$SCRIPT" --workspace /w --mode self-hosted --print-cmd)"
assert_contains "$out" "-P ubuntu-latest=-self-hosted"
assert_contains "$out" "--workflows /w/.github/workflows"
assert_contains "$out" "--json"

out="$(bash "$SCRIPT" --workspace /w --mode container --print-cmd)"
assert_contains "$out" "-P ubuntu-latest=localhost/act-runner:latest"
assert_contains "$out" "--pull=false"

out="$(ACT_SECRETS='FOO BAR' SECRET_FOO=xyzzy bash "$SCRIPT" --workspace /w --mode container --print-cmd)"
assert_contains "$out" "-s FOO"
assert_contains "$out" "-s BAR"
assert_absent   "$out" "xyzzy"

out="$(bash "$SCRIPT" --workspace /w --mode self-hosted --workflow .github/workflows/ci.yml --print-cmd)"
assert_contains "$out" "--workflows /w/.github/workflows/ci.yml"
assert_absent   "$out" "--workflows /w/.github/workflows "

out="$(bash "$SCRIPT" --workspace /w --mode container --event-name workflow_dispatch --job build --input a=1 --var b=2 --pull true --print-cmd)"
assert_contains "$out" "act workflow_dispatch"
assert_contains "$out" "-j build"
assert_contains "$out" "--input a=1"
assert_contains "$out" "--var b=2"
assert_contains "$out" "--pull=true"
case "$out" in
  "act workflow_dispatch "*) ;;
  *) echo "ORDER: expected event name as act's first positional in: $out"; fail=1;;
esac

out="$(bash "$SCRIPT" --workspace /w --mode container --label ubuntu-latest --label ubuntu-22.04 --print-cmd)"
assert_contains "$out" "-P ubuntu-latest=localhost/act-runner:latest"
assert_contains "$out" "-P ubuntu-22.04=localhost/act-runner:latest"

out="$(bash "$SCRIPT" --workspace /w --mode container --print-cmd)"
assert_contains "$out" "-P ubuntu-latest=localhost/act-runner:latest"
assert_absent   "$out" "-P ubuntu-22.04="

out="$(bash "$SCRIPT" --workspace /w --mode container --artifact-path /w/_artifacts --print-cmd)"
assert_contains "$out" "--artifact-server-path /w/_artifacts"

if [ "$fail" -eq 0 ]; then echo "act-run.test.sh: PASS"; else echo "act-run.test.sh: FAIL"; exit 1; fi

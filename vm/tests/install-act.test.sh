#!/usr/bin/env bash
set -u
SCRIPT="$(dirname "$0")/../provision/install-act.sh"
out="$(bash "$SCRIPT" --print-url 0.2.89)"
expected="https://github.com/nektos/act/releases/download/v0.2.89/act_Linux_x86_64.tar.gz"
if [ "$out" = "$expected" ]; then echo "install-act.test.sh: PASS"; else echo "install-act.test.sh: FAIL got '$out'"; exit 1; fi

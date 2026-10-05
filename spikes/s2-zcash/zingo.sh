#!/usr/bin/env bash
# Drive zingo-cli interactively (its one-shot --waitsync hangs on this regtest stack).
# usage: zingo.sh <wallet: tyr|user> "<cmd1>" ["<cmd2>" ...]   — waits for sync, runs cmds, quits.
set -euo pipefail
cd "$(dirname "$0")/../.."
W=$1; shift
SERVER="${ZCASH_LIGHTWALLETD_URL_REGTEST:-http://127.0.0.1:9067}"
{
  sleep "${ZINGO_SYNC_WAIT:-12}"
  for c in "$@"; do echo "$c"; sleep "${ZINGO_CMD_WAIT:-6}"; done
  echo quit
} | perl -e 'alarm 300; exec @ARGV' .tools/bin/zingo-cli --chain regtest --server "$SERVER" \
    --data-dir "$PWD/keys/zcash/$W" 2>&1 | grep -vE "WARNING: this build|^Launching|Save task|quit successfully"

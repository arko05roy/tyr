#!/usr/bin/env bash
# Start the tyr (:7200) and test-user (:7201) Zcash sidecars against the local regtest.
# Needs: infra/zcash-regtest up, infra/frost up, keys/frost from `frost-keygen keys/frost`.
# Build: (cd services/zcash-sidecar && CARGO_TARGET_DIR=../../.tools/src/zingolib/target cargo build --release)
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=.tools/src/zingolib/target/release/zcash-sidecar
IDX="${ZCASH_LIGHTWALLETD_URL_REGTEST:-http://127.0.0.1:9067}"
SIDECAR_ROLE=tyr WALLET_DIR="$PWD/keys/zcash/tyr" INDEXER_URI="$IDX" PORT=7200 \
  FROST_GROUP_FILE="$PWD/keys/frost/group.json" \
  FROST_SIGNERS=http://127.0.0.1:7101,http://127.0.0.1:7102,http://127.0.0.1:7103 \
  "$BIN" &
SIDECAR_ROLE=user WALLET_DIR="$PWD/keys/zcash/user" INDEXER_URI="$IDX" PORT=7201 "$BIN" &
wait

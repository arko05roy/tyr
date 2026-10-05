#!/usr/bin/env bash
# Spike S2 — Zcash memo-as-order round trip on LOCAL REGTEST (owner sign-off 2026-10-05).
# user wallet sends shielded ZEC to tyr's UA with a JSON order memo; tyr's wallet (holding the
# viewing key) decrypts the memo within 3 blocks. Requires infra/zcash-regtest up and tyr funded.
set -euo pipefail
cd "$(dirname "$0")/../.."
Z=spikes/s2-zcash/zingo.sh
mine() { curl -s 127.0.0.1:18232 -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"generate\",\"params\":[$1]}" >/dev/null; }
height() { curl -s 127.0.0.1:18232 -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' | jq -r .result; }
ua() { ZINGO_SYNC_WAIT=2 ZINGO_CMD_WAIT=2 $Z "$1" addresses | grep -oE 'uregtest1[0-9a-z]+' | head -1; }
txid() { grep -oE '"[0-9a-f]{64}"' | head -1 | tr -d '"'; }

TYR=$(ua tyr); USER=$(ua user)
echo "tyr  $TYR"; echo "user $USER"

# 1. make sure the user wallet has funds (tyr pays it 5 ZEC)
if ! $Z user balance | grep -qE 'confirmed_ironwood_balance: [1-9]'; then
  T=$(ZINGO_CMD_WAIT=30 $Z tyr "quicksend $USER 500000000" | txid); echo "fund user: $T"
fi
# shielded notes need several confirmations before zingo will spend them
mine 5

# 2. user → tyr: 0.1 ZEC with JSON order memo
NONCE=$(openssl rand -hex 8)
MEMO=$(python3 -c "import json,sys; print(json.dumps({'v':1,'market':'22571','side':'yes','size':'5','ret':sys.argv[1],'nonce':sys.argv[2]},separators=(',',':')))" "$USER" "$NONCE")
echo "memo (${#MEMO} bytes): $MEMO"
REQ=$(python3 -c "import json,sys; print(json.dumps([{'address':sys.argv[1],'amount':10000000,'memo':sys.argv[2]}]))" "$TYR" "$MEMO")
SENT_AT=$(height)
T=$(ZINGO_CMD_WAIT=30 $Z user "quicksend '$REQ'" | txid)
[[ -n "$T" ]] || { echo "✗ send failed"; exit 1; }
echo "order tx $T at height $SENT_AT"

# 3. tyr scans; must decrypt memo within 3 blocks
for i in 1 2 3; do
  mine 1
  if $Z tyr "messages $NONCE" | grep -q "$NONCE"; then
    echo "tyr decrypted memo after $i block(s) (height $(height)):"
    $Z tyr "messages $NONCE" | grep -E '"memo"|"txid"|"value"|"amount"' | head -6
    echo "✓ S2 PASS — txid $T"
    exit 0
  fi
done
echo "✗ memo not seen within 3 blocks"; exit 1

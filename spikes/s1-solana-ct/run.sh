#!/usr/bin/env bash
# Spike S1 — Token-2022 Confidential Transfer round trip on Solana DEVNET.
# Pass: create CT mint → configure accounts → deposit → apply pending → confidential transfer
#       → apply (recipient) → withdraw. Every signature is printed with a devnet explorer link.
# Requires: PAYER keypair with ≥0.5 devnet SOL. RECIPIENT keypair (gets funded by PAYER).
set -euo pipefail
cd "$(dirname "$0")/../.."

RPC="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PAYER="${S1_PAYER:-keys/s1-payer.json}"
RECIP="${S1_RECIPIENT:-keys/s1-recipient.json}"
GENESIS_DEVNET=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG

[[ "$(solana -u "$RPC" genesis-hash)" == "$GENESIS_DEVNET" ]] || { echo "✗ not devnet"; exit 1; }

T="spl-token -u $RPC --fee-payer $PAYER --program-2022"
ata() { spl-token --program-2022 address --token "$1" --owner "$2" --verbose --output json | jq -r .associatedTokenAddress; }

R_ADDR=$(solana address -k "$RECIP")
echo "payer $(solana address -k "$PAYER") balance $(solana -u "$RPC" balance -k "$PAYER")"
solana -u "$RPC" -k "$PAYER" transfer --allow-unfunded-recipient "$R_ADDR" 0.05 >/dev/null

echo "1. create confidential mint (auto-approve)"
MINT_KP=$(mktemp -t s1mint).json; solana-keygen new --no-bip39-passphrase -s -o "$MINT_KP" --force >/dev/null
$T create-token --mint-authority "$PAYER" --decimals 6 --enable-confidential-transfers auto "$MINT_KP"
MINT=$(solana address -k "$MINT_KP")

echo "2. create + configure CT accounts"
$T create-account "$MINT" --owner "$PAYER"
SRC=$(ata "$MINT" "$(solana address -k "$PAYER")")
$T configure-confidential-transfer-account --owner "$PAYER" --address "$SRC"
$T create-account "$MINT" --owner "$R_ADDR"
DST=$(ata "$MINT" "$R_ADDR")
$T configure-confidential-transfer-account --owner "$RECIP" --address "$DST"
echo "  src $SRC  dst $DST"

echo "3. mint 100 public → deposit 50 → apply pending"
$T mint "$MINT" 100 "$SRC" --mint-authority "$PAYER"
$T deposit-confidential-tokens "$MINT" 50 --address "$SRC" --owner "$PAYER"
$T apply-pending-balance --address "$SRC" --owner "$PAYER"

echo "4. confidential transfer 12.5 → recipient (ZK proofs verified on-chain)"
$T transfer "$MINT" 12.5 "$DST" --confidential --owner "$PAYER"
$T apply-pending-balance --address "$DST" --owner "$RECIP"

echo "5. recipient withdraws 2.5 confidential → public"
$T withdraw-confidential-tokens "$MINT" 2.5 --address "$DST" --owner "$RECIP"

echo "6. on-chain state (public balances only; confidential balances are ciphertext)"
spl-token -u "$RPC" --program-2022 display "$SRC"
spl-token -u "$RPC" --program-2022 display "$DST"
echo "✓ S1 PASS — mint $MINT  https://explorer.solana.com/address/$MINT?cluster=devnet"

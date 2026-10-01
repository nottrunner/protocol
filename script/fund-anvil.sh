#!/usr/bin/env bash
# Fund an account on a LOCAL anvil fork: native ETH via anvil_setBalance and an ERC-20 via storage write.
# Usage: script/fund-anvil.sh <anvil_rpc_url> <account> <token> <amount_raw_units>
# Finds the token's `balances` mapping slot by probing slots 0..20 (works for plain mapping layouts, e.g. USDC, USDG, WETH);
# the equivalent in a forge test is `deal(token, account, amount)`.
# Refuses to run against anything but localhost so it can never touch a real network.
set -euo pipefail
RPC=$1; ACCT=$2; TOKEN=$3; AMT=$4
case "$RPC" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "refusing: RPC must be local anvil" >&2; exit 1;; esac
cast rpc --rpc-url "$RPC" anvil_setBalance "$ACCT" 0x56BC75E2D63100000 >/dev/null   # 100 ETH
for slot in $(seq 0 20); do
  key=$(cast index address "$ACCT" "$slot")
  orig=$(cast rpc --rpc-url "$RPC" eth_getStorageAt "$TOKEN" "$key" latest | tr -d '"')
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$TOKEN" "$key" "$(cast to-uint256 "$AMT")" >/dev/null
  got=$(cast call --rpc-url "$RPC" "$TOKEN" 'balanceOf(address)(uint256)' "$ACCT" | awk '{print $1}')
  if [ "$got" = "$AMT" ]; then echo "funded $ACCT with $AMT of $TOKEN (balances slot $slot)"; exit 0; fi
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$TOKEN" "$key" "$orig" >/dev/null   # restore, try next slot
done
echo "could not find balances slot for $TOKEN; use a forge test with deal() or impersonate a holder" >&2; exit 1

#!/usr/bin/env bash
# Reproducible LOCAL fork dry run of script/DeployCore.s.sol. Never broadcasts, never uses a key.
# Usage: script/fork-dry-run.sh <ethereum|base|arbitrum|robinhood> [fork_block]
#   env: the chain's RPC var (ETHEREUM_NODE_MAINNET / _BASE / _ARBITRUM / _ROBINHOOD); public endpoints are used if unset.
# Output: deployments/<chain>.json (+ deployments/logs/<chain>.fork-run.txt), recorded as "kind": "fork, not mainnet", "mainnet": false.
# Refuses to overwrite a record whose kind is "mainnet broadcast".
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
CHAIN=$1; PIN=${2:-}
case "$CHAIN" in
  ethereum)  ID=1;     PORT=8601; URL=${ETHEREUM_NODE_MAINNET:-https://ethereum-rpc.publicnode.com};;
  base)      ID=8453;  PORT=8602; URL=${ETHEREUM_NODE_BASE:-https://base-rpc.publicnode.com};;
  arbitrum)  ID=42161; PORT=8603; URL=${ETHEREUM_NODE_ARBITRUM:-https://arb1.arbitrum.io/rpc};;
  robinhood) ID=4663;  PORT=8645; URL=${ETHEREUM_NODE_ROBINHOOD:-https://rpc.mainnet.chain.robinhood.com};;
  *) echo "unknown chain $CHAIN" >&2; exit 1;;
esac
SENDER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266   # Anvil public account #0 (address only)
[ -n "$PIN" ] || PIN=$(cast block-number --rpc-url "$URL")
OUTDIR=deployments; LOGDIR=deployments/logs; mkdir -p "$OUTDIR" "$LOGDIR"
LOG="$LOGDIR/$CHAIN.fork-run.txt"
# (DeployCore.s.sol enforces the same rule itself; this is just an early, friendlier failure)
if [ -f "$OUTDIR/$CHAIN.json" ] && [ "$(jq -r '.mainnet // false' "$OUTDIR/$CHAIN.json")" = "true" ]; then
  echo "refusing to overwrite $OUTDIR/$CHAIN.json: it is a mainnet record" >&2; exit 1
fi

# --compute-units-per-second/--retries/--fork-retry-backoff keep public RPCs (e.g. Robinhood, HTTP 429) from failing the fork
anvil --fork-url "$URL" --fork-block-number "$PIN" --port "$PORT" --chain-id "$ID" --compute-units-per-second 25 --retries 20 --fork-retry-backoff 1000 >/dev/null 2>&1 &
APID=$!; trap 'kill $APID 2>/dev/null || true' EXIT
for _ in $(seq 1 180); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 1; done
cast rpc --rpc-url "http://127.0.0.1:$PORT" evm_mine >/dev/null 2>&1 || true   # avoids "Excess blob gas not set" on some forks

forge build contracts >/dev/null
export CHAIN RUN_KIND=fork FORK_BLOCK=$PIN
export GIT_SHA=$(git rev-parse HEAD) CONFIG_SHA256=$(sha256sum "config/chains/$CHAIN.json" | cut -d' ' -f1)
export GIT_DIRTY=$([ -z "$(git status --porcelain -- script config foundry.toml contracts)" ] && echo false || echo true)
forge script script/DeployCore.s.sol:DeployCore --rpc-url "http://127.0.0.1:$PORT" --sender "$SENDER" -vv 2>&1 \
  | sed -e '/^Transactions saved to/d' -e '/^Sensitive values saved to/d' > "$LOG"
grep -q "Script ran successfully" "$LOG" || { cat "$LOG"; exit 1; }

python3 - "$OUTDIR/$CHAIN.json" "$LOG" <<'PY'
import hashlib, json, sys
p, log = sys.argv[1], sys.argv[2]
d = json.load(open(p))
d["log"] = {"path": log, "sha256": hashlib.sha256(open(log, "rb").read()).hexdigest()}
d["reproduce"] = "script/fork-dry-run.sh %s %s  (same commit + same fork block + same sender => same addresses)" % (d["chain"], d["forkBlock"])
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
PY
echo "wrote $OUTDIR/$CHAIN.json"

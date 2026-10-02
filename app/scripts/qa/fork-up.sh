#!/usr/bin/env bash
# QA helper (TEST-ONLY, local throwaway forks): start a LONG-LIVED Anvil fork of one chain at its latest block and BROADCAST
# script/DeployCore.s.sol to it (what script/fork-dry-run.sh does with BROADCAST_LOCAL=1, except that script kills its Anvil on
# exit and the app needs the fork to stay up). Writes $PROTOCOL_DIR/deployments/<chain>.json ("fork, not mainnet", simulated=false).
#
#   PROTOCOL_DIR=/path/to/checkout-with-script/DeployCore.s.sol  scripts/qa/fork-up.sh <ethereum|base|arbitrum|robinhood> [fork_block]
#   env: <ETHEREUM_NODE_MAINNET|_BASE|_ARBITRUM|_ROBINHOOD> upstream RPC (public endpoints by default), PORT_OFFSET (default 0)
#   ports: ethereum 8601, base 8602, arbitrum 8603, robinhood 8645 (+ PORT_OFFSET); pid file /tmp/qa-fork-<chain>.pid
# Stop with scripts/qa/fork-down.sh. Public RPCs are not archive: always fork the LATEST block (the default).
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
CHAIN=${1:?chain}; PIN=${2:-}
cd "${PROTOCOL_DIR:?set PROTOCOL_DIR to a checkout that has script/DeployCore.s.sol}"
OFF=${PORT_OFFSET:-0}
case "$CHAIN" in
  ethereum)  ID=1;     PORT=$((8601+OFF)); URL=${ETHEREUM_NODE_MAINNET:-https://ethereum-rpc.publicnode.com};;
  base)      ID=8453;  PORT=$((8602+OFF)); URL=${ETHEREUM_NODE_BASE:-https://base-rpc.publicnode.com};;
  arbitrum)  ID=42161; PORT=$((8603+OFF)); URL=${ETHEREUM_NODE_ARBITRUM:-https://arb1.arbitrum.io/rpc};;
  robinhood) ID=4663;  PORT=$((8645+OFF)); URL=${ETHEREUM_NODE_ROBINHOOD:-https://rpc.mainnet.chain.robinhood.com};;
  *) echo "unknown chain $CHAIN" >&2; exit 1;;
esac
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then echo "port $PORT is in use (stale anvil?); stop it first" >&2; exit 1; fi
[ -n "$PIN" ] || PIN=$(cast block-number --rpc-url "$URL")
setsid nohup anvil --fork-url "$URL" --fork-block-number "$PIN" --port "$PORT" --chain-id "$ID" \
  --compute-units-per-second 25 --retries 20 --fork-retry-backoff 1000 >"/tmp/qa-fork-$CHAIN.log" 2>&1 &
echo $! > "/tmp/qa-fork-$CHAIN.pid"
for _ in $(seq 1 180); do cast chain-id --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break; sleep 1; done
cast rpc --rpc-url "http://127.0.0.1:$PORT" evm_mine >/dev/null 2>&1 || true   # avoids "Excess blob gas not set" on some forks
forge build contracts >/dev/null
export CHAIN RUN_KIND=fork FORK_BLOCK=$PIN
export GIT_SHA=$(git rev-parse HEAD) CONFIG_SHA256=$(sha256sum "config/chains/$CHAIN.json" | cut -d' ' -f1)
export GIT_DIRTY=$([ -z "$(git status --porcelain -- script config foundry.toml contracts)" ] && echo false || echo true)
mkdir -p deployments/logs
forge script script/DeployCore.s.sol:DeployCore --rpc-url "http://127.0.0.1:$PORT" --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --unlocked --broadcast -vv > "deployments/logs/$CHAIN.fork-run.txt" 2>&1 || { tail -30 "deployments/logs/$CHAIN.fork-run.txt"; exit 1; }
echo "$CHAIN fork up on http://127.0.0.1:$PORT (block $PIN); record: $PWD/deployments/$CHAIN.json"

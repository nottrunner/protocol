#!/usr/bin/env bash
# Confirm a real broadcast and turn deployments/<chain>.pending.json into deployments/<chain>.json.
# This is the only way to get "mainnet": true (and only for chain ids in config/mainnet-chain-ids.json).
# Usage: script/finalize-broadcast.sh <chain> --rpc-url <url>   (or FINALIZE_RPC_URL=...; never printed or stored). See finalize_broadcast.py.
exec python3 "$(dirname "$0")/finalize_broadcast.py" "$@"

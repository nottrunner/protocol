#!/usr/bin/env python3
"""Turn deployments/<chain>.pending.json into deployments/<chain>.json after a REAL broadcast, but only if it is proven.

DeployCore.s.sol runs as a simulation: the addresses it writes are predictions, and the transactions are sent only after the
script returns. So the script writes an UNCONFIRMED pending record and never "mainnet": true. This tool is the only thing that
may produce a "mainnet broadcast" / "mainnet": true record. It refuses unless ALL of these hold:
  * the RPC is a real node (it rejects anvil_nodeInfo) and its eth_chainId equals the pending record's chainId
  * broadcast/DeployCore.s.sol/<chainId>/run-latest.json exists, has the same chain id, and every transaction has a receipt
    with status 0x1 (in the file AND as returned by the RPC)
  * every address in the pending record was created by one of those transactions and has contract code on-chain
  * an existing mainnet record is not overwritten (unless OVERWRITE_MAINNET_RECORD=true)
The label depends on config/mainnet-chain-ids.json: listed chain ids -> kind "mainnet broadcast", mainnet true;
anything else -> kind "testnet or unknown network", mainnet false.

Usage: script/finalize-broadcast.sh <chain> --rpc-url <url>      (or env FINALIZE_RPC_URL; the URL is never printed or stored)
No private key is involved; this only reads.
"""
import argparse, json, os, sys, urllib.request


class Refuse(Exception):
    pass


def rpc(url, method, params=None):
    req = urllib.request.Request(
        url,
        data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    if "error" in body:
        raise RuntimeError(body["error"])
    return body["result"]


def load(path, what):
    if not os.path.isfile(path):
        raise Refuse("missing %s: %s" % (what, path))
    with open(path) as f:
        return json.load(f)


def finalize(chain, rpc_url, root=".", env=os.environ):
    dep = os.path.join(root, "deployments")
    pending_path = os.path.join(dep, chain + ".pending.json")
    final_path = os.path.join(dep, chain + ".json")
    pending = load(pending_path, "pending record (run DeployCore with RUN_KIND=broadcast --broadcast first)")

    if pending.get("pendingBroadcast") is not True or pending.get("mainnet") is not False or pending.get("runKind") != "broadcast":
        raise Refuse("%s is not an unconfirmed broadcast record" % pending_path)
    chain_id = int(pending["chainId"])

    if os.path.isfile(final_path):
        old = load(final_path, "existing record")
        if old.get("mainnet") is True and env.get("OVERWRITE_MAINNET_RECORD") != "true":
            raise Refuse("%s is a mainnet record; set OVERWRITE_MAINNET_RECORD=true to replace it" % final_path)

    # 1. a real node of the right chain
    try:
        rpc(rpc_url, "anvil_nodeInfo")
        raise Refuse("the RPC is an Anvil node: a fork can never produce a broadcast record")
    except RuntimeError:
        pass  # real nodes reject anvil_nodeInfo
    got = int(rpc(rpc_url, "eth_chainId"), 16)
    if got != chain_id:
        raise Refuse("RPC chain id %d != pending record chain id %d" % (got, chain_id))

    # 2. broadcast receipts
    run_path = os.path.join(root, "broadcast", "DeployCore.s.sol", str(chain_id), "run-latest.json")
    run = load(run_path, "broadcast log")
    if int(run.get("chain", -1)) != chain_id:
        raise Refuse("run-latest.json is for chain %s, not %d" % (run.get("chain"), chain_id))
    txs, receipts = run.get("transactions") or [], run.get("receipts") or []
    if not txs:
        raise Refuse("run-latest.json has no transactions")
    if len(receipts) != len(txs) or run.get("pending"):
        raise Refuse("run-latest.json: %d transactions but %d receipts (pending: %s); wait or use forge script --resume"
                     % (len(txs), len(receipts), run.get("pending")))
    by_hash = {r["transactionHash"].lower(): r for r in receipts}
    blocks = []
    for t in txs:
        r = by_hash.get(t["hash"].lower())
        if r is None or int(r["status"], 16) != 1:
            raise Refuse("transaction %s has no successful receipt in run-latest.json" % t["hash"])
        onchain = rpc(rpc_url, "eth_getTransactionReceipt", [t["hash"]])
        if not onchain or int(onchain["status"], 16) != 1:
            raise Refuse("transaction %s is not successful on-chain" % t["hash"])
        blocks.append(int(onchain["blockNumber"], 16))

    # 3. every recorded address was created by the broadcast and has code
    created = set()
    for t in txs:
        if t.get("contractAddress"):
            created.add(t["contractAddress"].lower())
        for c in t.get("additionalContracts") or []:
            created.add(c["address"].lower())
    for name, addr in sorted(pending["addresses"].items()):
        if addr.lower() not in created:
            raise Refuse("%s (%s) was not created by the broadcast transactions" % (name, addr))
        code = rpc(rpc_url, "eth_getCode", [addr, "latest"])
        if code in (None, "0x", "0x0"):
            raise Refuse("%s (%s) has no contract code on-chain" % (name, addr))

    # 4. label from the single allowlist
    ids = load(os.path.join(root, "config", "mainnet-chain-ids.json"), "mainnet chain id allowlist")["mainnetChainIds"]
    is_mainnet = chain_id in ids
    rec = dict(pending)
    rec.pop("pendingBroadcast", None)
    rec["simulated"] = False
    rec["mainnet"] = is_mainnet
    rec["kind"] = "mainnet broadcast" if is_mainnet else "testnet or unknown network"
    rec["label"] = "REAL BROADCAST DEPLOYMENT" if is_mainnet else "BROADCAST ON A NON-MAINNET OR UNKNOWN NETWORK (chain id not in config/mainnet-chain-ids.json)"
    rec["confirmation"] = {
        "broadcastLog": os.path.relpath(run_path, root),
        "transactions": len(txs),
        "allReceiptsSuccessful": True,
        "firstBlock": min(blocks),
        "lastBlock": max(blocks),
        "everyAddressHasCode": True,
    }
    with open(final_path, "w") as f:
        json.dump(rec, f, indent=2, sort_keys=True)
        f.write("\n")
    os.remove(pending_path)
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("chain", choices=["ethereum", "base", "arbitrum", "robinhood", "hyperliquid"])
    ap.add_argument("--rpc-url", default=os.environ.get("FINALIZE_RPC_URL"))
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    a = ap.parse_args()
    if not a.rpc_url:
        ap.error("--rpc-url or FINALIZE_RPC_URL is required")
    try:
        rec = finalize(a.chain, a.rpc_url, a.root)
    except Refuse as e:
        print("REFUSED: %s" % e, file=sys.stderr)
        sys.exit(1)
    print("wrote deployments/%s.json: kind=%r mainnet=%s (%d txs confirmed)" % (a.chain, rec["kind"], rec["mainnet"], rec["confirmation"]["transactions"]))


if __name__ == "__main__":
    main()

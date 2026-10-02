#!/usr/bin/env python3
"""Tests for script/finalize_broadcast.py against a fake JSON-RPC node. Run: python3 script/test/test_finalize_broadcast.py"""
import json, os, shutil, sys, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import finalize_broadcast as fb  # noqa: E402

def load_json(path):
    with open(path) as f:
        return json.load(f)


def dump(obj, path):
    with open(path, "w") as f:
        json.dump(obj, f)


REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
ADDRS = {"dispatcher": "0x" + "11" * 20, "fundDeployer": "0x" + "22" * 20}


class Node:
    """A tiny fake node. is_anvil=True makes it answer anvil_nodeInfo like Anvil."""

    def __init__(self, chain_id, is_anvil=False, code=True, receipt_ok=True):
        self.chain_id, self.is_anvil, self.code, self.receipt_ok = chain_id, is_anvil, code, receipt_ok
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                req = json.loads(self.rfile.read(int(self.headers["content-length"])))
                m, p = req["method"], req.get("params", [])
                res, err = None, None
                if m == "anvil_nodeInfo":
                    if outer.is_anvil:
                        res = {}
                    else:
                        err = {"code": -32601, "message": "method not found"}
                elif m == "eth_chainId":
                    res = hex(outer.chain_id)
                elif m == "eth_getTransactionReceipt":
                    res = {"status": "0x1" if outer.receipt_ok else "0x0", "blockNumber": "0x64"}
                elif m == "eth_getCode":
                    res = "0x6080" if (outer.code is True or p[0].lower() not in outer.code) else "0x"
                body = json.dumps({"jsonrpc": "2.0", "id": 1, **({"error": err} if err else {"result": res})}).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.srv.server_port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()


def make_root(chain_id, chain="base", addresses=ADDRS, receipts_ok=True, drop_receipt=False, extra_tx_for=None):
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, "deployments"))
    os.makedirs(os.path.join(root, "config"))
    shutil.copy(os.path.join(REPO, "config", "mainnet-chain-ids.json"), os.path.join(root, "config"))
    pending = {
        "kind": "mainnet broadcast (PENDING receipt confirmation)", "mainnet": False, "simulated": True, "pendingBroadcast": True,
        "runKind": "broadcast", "chain": chain, "chainId": chain_id, "forkBlock": 0, "scriptCommit": "abc",
        "denominationAsset": {"symbol": "USDC", "address": "0x" + "33" * 20}, "addresses": addresses,
    }
    dump(pending, os.path.join(root, "deployments", chain + ".pending.json"))
    txs = [{"hash": "0x%064x" % (i + 1), "transactionType": "CREATE", "contractAddress": a.lower(), "additionalContracts": []}
           for i, a in enumerate(extra_tx_for or addresses.values())]
    rec = [{"transactionHash": t["hash"], "status": "0x1" if receipts_ok else "0x0", "blockNumber": "0x64"} for t in txs]
    if drop_receipt:
        rec = rec[:-1]
    d = os.path.join(root, "broadcast", "DeployCore.s.sol", str(chain_id))
    os.makedirs(d)
    dump({"chain": chain_id, "transactions": txs, "receipts": rec, "pending": []}, os.path.join(d, "run-latest.json"))
    return root


class FinalizeTest(unittest.TestCase):
    def run_case(self, chain_id, node_kwargs=None, chain="base", **root_kwargs):
        root = make_root(chain_id, chain, **root_kwargs)
        node = Node(node_kwargs.pop("node_chain_id", chain_id), **(node_kwargs or {}))
        self.addCleanup(node.close)
        self.addCleanup(shutil.rmtree, root)
        return root, node

    def read(self, root, chain="base"):
        return load_json(os.path.join(root, "deployments", chain + ".json"))

    def test_known_mainnet_becomes_mainnet_record_and_pending_is_removed(self):
        root, node = self.run_case(8453, {})
        rec = fb.finalize("base", node.url, root)
        self.assertEqual((rec["kind"], rec["mainnet"], rec["simulated"]), ("mainnet broadcast", True, False))
        self.assertNotIn("pendingBroadcast", rec)
        self.assertEqual(rec["chainId"], 8453)
        self.assertEqual(rec["scriptCommit"], "abc")
        self.assertEqual(rec["denominationAsset"]["symbol"], "USDC")
        self.assertEqual(rec["confirmation"]["transactions"], 2)
        self.assertFalse(os.path.exists(os.path.join(root, "deployments", "base.pending.json")))
        self.assertEqual(self.read(root)["mainnet"], True)

    def test_unknown_network_is_never_labelled_mainnet(self):
        root, node = self.run_case(11155111, {})
        rec = fb.finalize("base", node.url, root)
        self.assertEqual((rec["kind"], rec["mainnet"]), ("testnet or unknown network", False))

    def test_hyperevm_is_not_a_known_mainnet_yet(self):
        root, node = self.run_case(999, {})
        self.assertFalse(fb.finalize("base", node.url, root)["mainnet"])

    def test_refuses_anvil_node(self):
        root, node = self.run_case(8453, {"is_anvil": True})
        with self.assertRaisesRegex(fb.Refuse, "Anvil"):
            fb.finalize("base", node.url, root)
        self.assertFalse(os.path.exists(os.path.join(root, "deployments", "base.json")))

    def test_refuses_chain_id_mismatch(self):
        root, node = self.run_case(8453, {"node_chain_id": 1})
        with self.assertRaisesRegex(fb.Refuse, "chain id"):
            fb.finalize("base", node.url, root)

    def test_refuses_failed_receipt_in_log(self):
        root, node = self.run_case(8453, {}, receipts_ok=False)
        with self.assertRaisesRegex(fb.Refuse, "successful receipt"):
            fb.finalize("base", node.url, root)

    def test_refuses_failed_receipt_onchain(self):
        root, node = self.run_case(8453, {"receipt_ok": False})
        with self.assertRaisesRegex(fb.Refuse, "not successful on-chain"):
            fb.finalize("base", node.url, root)

    def test_refuses_missing_receipt(self):
        root, node = self.run_case(8453, {}, drop_receipt=True)
        with self.assertRaisesRegex(fb.Refuse, "receipts"):
            fb.finalize("base", node.url, root)

    def test_refuses_address_without_code(self):
        root, node = self.run_case(8453, {"code": {ADDRS["dispatcher"].lower()}})
        with self.assertRaisesRegex(fb.Refuse, "no contract code"):
            fb.finalize("base", node.url, root)

    def test_refuses_address_not_created_by_broadcast(self):
        root, node = self.run_case(8453, {}, extra_tx_for=[ADDRS["dispatcher"], "0x" + "44" * 20])
        with self.assertRaisesRegex(fb.Refuse, "not created by the broadcast"):
            fb.finalize("base", node.url, root)

    def test_refuses_without_pending_record(self):
        root, node = self.run_case(8453, {})
        os.remove(os.path.join(root, "deployments", "base.pending.json"))
        with self.assertRaisesRegex(fb.Refuse, "missing pending record"):
            fb.finalize("base", node.url, root)

    def test_refuses_a_record_that_is_not_pending(self):
        root, node = self.run_case(8453, {})
        p = os.path.join(root, "deployments", "base.pending.json")
        d = load_json(p); d["mainnet"] = True
        dump(d, p)
        with self.assertRaisesRegex(fb.Refuse, "not an unconfirmed broadcast record"):
            fb.finalize("base", node.url, root)

    def test_refuses_without_broadcast_log(self):
        root, node = self.run_case(8453, {})
        shutil.rmtree(os.path.join(root, "broadcast"))
        with self.assertRaisesRegex(fb.Refuse, "missing broadcast log"):
            fb.finalize("base", node.url, root)

    def test_never_overwrites_mainnet_record_unless_explicit(self):
        root, node = self.run_case(8453, {})
        dump({"mainnet": True}, os.path.join(root, "deployments", "base.json"))
        with self.assertRaisesRegex(fb.Refuse, "mainnet record"):
            fb.finalize("base", node.url, root, env={})
        self.assertEqual(self.read(root), {"mainnet": True})
        fb.finalize("base", node.url, root, env={"OVERWRITE_MAINNET_RECORD": "true"})
        self.assertEqual(self.read(root)["kind"], "mainnet broadcast")

    def test_overwrites_a_fork_record(self):
        root, node = self.run_case(8453, {})
        dump({"mainnet": False, "kind": "fork, not mainnet"}, os.path.join(root, "deployments", "base.json"))
        self.assertEqual(fb.finalize("base", node.url, root)["kind"], "mainnet broadcast")


if __name__ == "__main__":
    unittest.main(verbosity=2)

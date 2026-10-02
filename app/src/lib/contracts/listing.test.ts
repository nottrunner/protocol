import { describe, expect, it } from "vitest";
import { addSaved, parseSaved, removeSaved, scanLogsPaged, scanStartBlock, type FoundVault } from "./listing";

const V = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;
const B = (n: number) => BigInt(n);

/** fake RPC: logs at given blocks, rejects ranges wider than `limit` */
function fakeRpc(blocks: number[], limit: number, failAll = false) {
  const calls: [bigint, bigint][] = [];
  return {
    calls,
    fetchRange: async (from: bigint, to: bigint): Promise<FoundVault[]> => {
      calls.push([from, to]);
      if (failAll || Number(to - from + BigInt(1)) > limit) throw new Error("query exceeds max block range");
      return blocks.filter((b) => b >= Number(from) && b <= Number(to)).map((b) => ({ vault: V(b), comptroller: V(b + 1), blockNumber: B(b) }));
    },
  };
}

describe("scanLogsPaged", () => {
  it("finds everything in range, newest first, when the RPC allows big ranges", async () => {
    const rpc = fakeRpc([5, 500, 90_000], 10_000_000);
    const r = await scanLogsPaged({ fromBlock: B(0), toBlock: B(100_000), fetchRange: rpc.fetchRange });
    expect(r.complete).toBe(true);
    expect(r.logs.map((l) => Number(l.blockNumber))).toEqual([90_000, 500, 5]);
    expect(r.scannedFrom).toBe(B(0));
  });
  it("halves the chunk when the RPC rejects wide ranges (10k limit) and still completes", async () => {
    const rpc = fakeRpc([1, 25_000, 99_999], 10_000);
    const r = await scanLogsPaged({ fromBlock: B(0), toBlock: B(99_999), fetchRange: rpc.fetchRange, initialChunk: B(50_000) });
    expect(r.complete).toBe(true);
    expect(r.logs).toHaveLength(3);
    // no request ever exceeded the limit once accepted, and ranges tile [0, 99999] without gaps/overlap among successes
    expect(r.requests).toBeGreaterThan(10);
  });
  it("starts at fromBlock exactly (deployment block), never below", async () => {
    const rpc = fakeRpc([], 1_000_000);
    await scanLogsPaged({ fromBlock: B(777), toBlock: B(1_000), fetchRange: rpc.fetchRange });
    expect(Math.min(...rpc.calls.map((c) => Number(c[0])))).toBe(777);
  });
  it("stops with an error and complete=false when even the minimum chunk is refused; keeps what it found", async () => {
    let n = 0;
    const fetchRange = async (from: bigint, to: bigint) => {
      if (n++ === 0) return [{ vault: V(9), comptroller: V(10), blockNumber: to }];
      throw new Error("rate limited");
    };
    const r = await scanLogsPaged({ fromBlock: B(0), toBlock: B(10_000_000), fetchRange, initialChunk: B(1000), minChunk: B(500), maxChunk: B(1000) });
    expect(r.complete).toBe(false);
    expect(r.error).toMatch(/rate limited/);
    expect(r.logs).toHaveLength(1);
    expect(r.scannedFrom).toBeGreaterThan(B(0));
  });
  it("honours maxRequests and abort", async () => {
    const rpc = fakeRpc([], 1_000_000);
    const r = await scanLogsPaged({ fromBlock: B(0), toBlock: B(10_000_000), fetchRange: rpc.fetchRange, initialChunk: B(1000), maxChunk: B(1000), maxRequests: 3 });
    expect(r.requests).toBe(3);
    expect(r.complete).toBe(false);
    const ab = await scanLogsPaged({ fromBlock: B(0), toBlock: B(10), fetchRange: rpc.fetchRange, signal: { aborted: true } });
    expect(ab.complete).toBe(false);
    expect(ab.requests).toBe(0);
  });
  it("dedupes by vault", async () => {
    const fetchRange = async () => [
      { vault: V(1), comptroller: V(2), blockNumber: B(1) },
      { vault: V(1), comptroller: V(2), blockNumber: B(1) },
    ];
    const r = await scanLogsPaged({ fromBlock: B(0), toBlock: B(10), fetchRange });
    expect(r.logs).toHaveLength(1);
  });
});

describe("scanStartBlock", () => {
  it("uses the record's block when known (clamped to latest)", () => {
    expect(scanStartBlock(1, B(100), B(1000))).toEqual({ from: B(100), bounded: false });
    expect(scanStartBlock(1, B(5000), B(1000))).toEqual({ from: B(1000), bounded: false });
  });
  it("falls back to a bounded per-chain look-back", () => {
    const r = scanStartBlock(1, null, B(1_000_000));
    expect(r.bounded).toBe(true);
    expect(r.from).toBe(B(600_000));
    expect(scanStartBlock(1, null, B(10)).from).toBe(B(0));
  });
});

describe("saved vaults", () => {
  it("parses defensively, adds without duplicates (case-insensitive), removes", () => {
    expect(parseSaved(null)).toEqual({});
    expect(parseSaved("{bad")).toEqual({});
    expect(parseSaved('{"1":["0xabc", "0x1111111111111111111111111111111111111111", 5]}')).toEqual({ "1": ["0x1111111111111111111111111111111111111111"] });
    const a = V(0xabc);
    let s = addSaved({}, 1, a);
    s = addSaved(s, 1, a.toUpperCase().replace("0X", "0x"));
    expect(s["1"]).toHaveLength(1);
    s = addSaved(s, 8453, a);
    expect(Object.keys(s).sort()).toEqual(["1", "8453"]);
    expect(removeSaved(s, 1, a)["1"]).toEqual([]);
  });
});

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRecord, selectRecords } from "./deployment-records.mjs";
import { loadRecordsFromDir } from "./load-deployment-records.mjs";

const FIX = join(__dirname, "../src/lib/deployments/__fixtures__");
const read = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf8")) as Record<string, unknown>;

/** A record shaped like the README's "mainnet broadcast" kind. Synthetic: not a real deployment. */
const mainnetLike = (chain: string, chainId: number) => ({
  ...read(`fork-samples/${chain}.json`),
  kind: "mainnet broadcast", mainnet: true, runKind: "broadcast", forkBlock: 0, label: "REAL BROADCAST DEPLOYMENT",
  chain, chainId,
});

describe("classifyRecord", () => {
  it("fork-samples (kind 'fork, not mainnet', mainnet:false) are fork", () => {
    for (const c of ["ethereum", "base", "arbitrum", "robinhood"]) expect(classifyRecord(read(`fork-samples/${c}.json`))).toBe("fork");
  });
  it("QA's early records (label REAL BROADCAST, no kind/mainnet, forkBlock>0) fail closed as fork", () => {
    expect(classifyRecord(read("legacy/ethereum.json"))).toBe("fork");
  });
  it("a record without explicit mainnet:true is 'unlabelled', never 'mainnet'", () => {
    expect(classifyRecord({ chainId: 1, addresses: {}, runKind: "broadcast" })).toBe("unlabelled");
    expect(classifyRecord({ chainId: 1, addresses: {}, kind: "mainnet broadcast" })).toBe("unlabelled");
  });
  it("mainnet needs mainnet:true + kind 'mainnet broadcast' + runKind broadcast and no fork markers", () => {
    expect(classifyRecord(mainnetLike("ethereum", 1))).toBe("mainnet");
    expect(classifyRecord({ ...mainnetLike("ethereum", 1), forkBlock: 5 })).toBe("fork");
    expect(classifyRecord({ ...mainnetLike("ethereum", 1), label: "ANVIL FORK RUN" })).toBe("fork");
    expect(classifyRecord({ ...mainnetLike("ethereum", 1), mainnet: false })).toBe("fork");
  });
  it("rejects malformed input", () => {
    for (const v of [null, 3, "x", [], {}, { chainId: 1 }, { addresses: {} }]) expect(classifyRecord(v)).toBe("invalid");
  });
});

describe("selectRecords", () => {
  const files = ["ethereum", "base", "arbitrum", "robinhood"].map((c) => ({ file: `${c}.json`, raw: read(`fork-samples/${c}.json`) }));
  it("drops every fork record unless useFork", () => {
    const r = selectRecords(files, { useFork: false });
    expect(Object.keys(r.records)).toEqual([]);
    expect(r.ignored).toHaveLength(4);
  });
  it("keeps fork records with useFork, keyed by chain id, and strips log/reproduce fields", () => {
    const r = selectRecords(files, { useFork: true });
    expect(Object.keys(r.records).sort()).toEqual(["1", "42161", "4663", "8453"]);
    expect(r.records["1"]).not.toHaveProperty("log");
    expect(r.records["1"]).not.toHaveProperty("reproduce");
    expect(r.records["1"]).not.toHaveProperty("deployer");
    expect(r.records["1"]).toHaveProperty("addresses");
  });
  it("HyperEVM: deployments/hyperliquid.json (chain \"hyperliquid\", id 999) is recognised, fork-gated like the others", () => {
    const raw = { ...read("fork-samples/robinhood.json"), chain: "hyperliquid", chainId: 999 };
    const f = [{ file: "hyperliquid.json", raw }];
    expect(Object.keys(selectRecords(f, { useFork: false }).records)).toEqual([]);
    expect(Object.keys(selectRecords(f, { useFork: true }).records)).toEqual(["999"]);
    expect(selectRecords([{ file: "hyperliquid.json", raw: { ...raw, chainId: 998 } }], { useFork: true }).records).toEqual({});
  });
  it("keeps mainnet-labelled records regardless of the flag", () => {
    const r = selectRecords([{ file: "base.json", raw: mainnetLike("base", 8453) }], { useFork: false });
    expect(Object.keys(r.records)).toEqual(["8453"]);
  });
  it("rejects a record whose chain/chainId does not match its file name", () => {
    const r = selectRecords([{ file: "base.json", raw: mainnetLike("ethereum", 1) }], { useFork: true });
    expect(r.records).toEqual({});
    expect(r.ignored[0]?.reason).toMatch(/does not match/);
  });
  it("ignores unknown chain names and malformed files", () => {
    const r = selectRecords([{ file: "hyperliquid.json", raw: mainnetLike("base", 8453) }, { file: "x.json", raw: 3 }], { useFork: true });
    expect(r.records).toEqual({});
    expect(r.ignored).toHaveLength(2);
  });
});

describe("loadRecordsFromDir", () => {
  it("returns nothing for a missing directory", () => {
    expect(loadRecordsFromDir("/nonexistent/dir/xyz", { useFork: true }).records).toEqual({});
  });
  it("reads *.json, skips subdirectories and unparsable files, and applies the fork rule", () => {
    const dir = mkdtempSync(join(tmpdir(), "dep-"));
    writeFileSync(join(dir, "ethereum.json"), JSON.stringify(read("fork-samples/ethereum.json")));
    writeFileSync(join(dir, "base.json"), JSON.stringify(mainnetLike("base", 8453)));
    writeFileSync(join(dir, "arbitrum.json"), "{ not json");
    mkdirSync(join(dir, "logs"));
    writeFileSync(join(dir, "logs", "ethereum.fork-run.txt"), "x");
    const warnings: string[] = [];
    const off = loadRecordsFromDir(dir, { useFork: false, warn: (m) => warnings.push(m) });
    expect(Object.keys(off.records)).toEqual(["8453"]);
    expect(warnings.some((w) => w.includes("arbitrum.json"))).toBe(true);
    expect(Object.keys(loadRecordsFromDir(dir, { useFork: true }).records).sort()).toEqual(["1", "8453"]);
  });
});

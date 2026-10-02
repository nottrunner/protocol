import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDenominationAssetsEnv, parseInlinedRecords, resolveChainDeployment, resolveSwapAdapters } from "./loader";

const FIX = join(__dirname, "__fixtures__");
const read = (p: string) => JSON.parse(readFileSync(join(FIX, p), "utf8")) as Record<string, unknown>;
const CHAINS = { ethereum: 1, base: 8453, arbitrum: 42161, robinhood: 4663 } as const;
const forkRecords = Object.fromEntries(Object.entries(CHAINS).map(([n, id]) => [String(id), read(`fork-samples/${n}.json`)]));
const mainnetLike = (chain: keyof typeof CHAINS, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...read(`fork-samples/${chain}.json`),
  kind: "mainnet broadcast", mainnet: true, runKind: "broadcast", forkBlock: 0, label: "REAL BROADCAST DEPLOYMENT", ...extra,
});
const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";

describe("fork-samples shapes", () => {
  it("fork records are IGNORED by default (useFork=false): chain shows as not deployed", () => {
    for (const id of Object.values(CHAINS)) {
      const d = resolveChainDeployment(id, { records: forkRecords, useFork: false, env: {} });
      expect(d.fundDeployer).toBeNull();
      expect(d.origin).toBe("none");
      expect(d.notes.join(" ")).toMatch(/fork deployment record ignored/);
    }
  });

  it("with useFork=true the fork-sample addresses, denomination asset and fork flag load for all four chains", () => {
    for (const [name, id] of Object.entries(CHAINS)) {
      const raw = forkRecords[String(id)] as { addresses: Record<string, string>; denominationAsset: { symbol: string; address: string } };
      const d = resolveChainDeployment(id, { records: forkRecords, useFork: true, env: {} });
      expect(d.origin).toBe("record");
      expect(d.isFork).toBe(true);
      expect(d.recordSource).toBe("fork");
      expect(d.fundDeployer?.toLowerCase()).toBe(raw.addresses.fundDeployer?.toLowerCase());
      expect(d.addresses.valueInterpreter?.toLowerCase()).toBe(raw.addresses.valueInterpreter?.toLowerCase());
      expect(d.addresses.fundValueCalculatorRouter).toBeDefined();
      expect(d.denominationSource).toBe("record");
      expect(d.denominationAssets).toHaveLength(1);
      expect(d.denominationAssets[0]?.symbol).toBe(name === "robinhood" ? "USDG" : "USDC");
      expect(d.denominationAssets[0]?.address.toLowerCase()).toBe(raw.denominationAsset.address.toLowerCase());
    }
  });

  it("Robinhood: USDG denomination, swaps off even if an adapter is present", () => {
    const rec = { ...forkRecords["4663"] as object, adapters: { uniswapV3Adapter: A1, uniswapV3SwapRouter02Adapter: A2 } };
    const d = resolveChainDeployment(4663, { records: { "4663": rec }, useFork: true, env: {} });
    expect(d.denominationAssets[0]?.address).toBe("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
    expect(d.swapAdapter).toBeNull();
  });

  it("fromBlock: fork records use forkBlock (NOT blockNumberAtDeploy, which is an L1 number on Orbit chains)", () => {
    const arb = resolveChainDeployment(42161, { records: forkRecords, useFork: true, env: {} });
    expect(arb.fromBlock).toBe(BigInt(510944642));
    expect(arb.fromBlockSource).toBe("forkBlock");
    const eth = resolveChainDeployment(1, { records: forkRecords, useFork: true, env: {} });
    expect(eth.fromBlock).toBe(BigInt(26103767));
  });

  it("legacy QA record (REAL BROADCAST label, no kind/mainnet) is ignored by default, loads (as fork) with the flag, falls back to token list", () => {
    const records = { "1": read("legacy/ethereum.json") };
    expect(resolveChainDeployment(1, { records, useFork: false, env: {} }).fundDeployer).toBeNull();
    const d = resolveChainDeployment(1, { records, useFork: true, env: {} });
    expect(d.isFork).toBe(true);
    expect(d.fundDeployer).toBe("0xd1D84F3bb531f12ab5B348fD8DFCFf1B07FB3446");
    expect(d.denominationSource).toBe("fallback");
    expect(d.denominationAssets.map((a) => a.symbol)).toEqual(["USDC"]);
    expect(d.fromBlock).toBe(BigInt(26103732));
  });
});

describe("fork-samples with adapters (shape of PR #8 feat/register-adapters @ 3362c1f)", () => {
  const withAdapters = Object.fromEntries(
    Object.entries(CHAINS).map(([n, id]) => [String(id), read(`fork-samples-adapters/${n}.json`)]),
  );
  const load = (id: number) => resolveChainDeployment(id, { records: withAdapters, useFork: true, env: {} });
  const addr = (id: number, k: string) => (withAdapters[String(id)] as { addresses: Record<string, string> }).addresses[k]?.toLowerCase();
  it("Ethereum + Arbitrum: routes are [UniswapV3Adapter, ParaSwapV6Adapter]; Uniswap default with the official QuoterV2", () => {
    for (const id of [1, 42161]) {
      const d = load(id);
      expect(d.swapAdapters.map((r) => r.kind)).toEqual(["uniswapV3", "paraSwapV6"]);
      expect(d.swapAdapter?.address.toLowerCase()).toBe(addr(id, "uniswapV3Adapter"));
      expect(d.swapAdapters[1]?.address.toLowerCase()).toBe(addr(id, "paraSwapV6Adapter"));
      expect(d.swapAdapter?.quoter).toBe("0x61fFE014bA17989E743c5F6cB21bF9697530B21e");
      expect(d.approvedAdaptersListId).toBe(1);
    }
  });
  it("Base: routes are [UniswapV3SwapRouter02Adapter, ParaSwapV6Adapter]", () => {
    const d = load(8453);
    expect(d.swapAdapters.map((r) => r.kind)).toEqual(["uniswapV3SwapRouter02", "paraSwapV6"]);
    expect(d.swapAdapter?.address.toLowerCase()).toBe(addr(8453, "uniswapV3SwapRouter02Adapter"));
    expect(d.swapAdapter?.quoter).toBe("0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a");
  });
  it("Robinhood: no adapters, swaps off", () => {
    expect(load(4663).swapAdapters).toEqual([]);
    expect(load(4663).approvedAdaptersListId).toBeNull();
  });
  it("Base record with only the original-router adapter => swaps off", () => {
    const rec = JSON.parse(JSON.stringify(withAdapters["8453"])) as { addresses: Record<string, string> };
    delete rec.addresses.uniswapV3SwapRouter02Adapter;
    delete rec.addresses.paraSwapV6Adapter;
    rec.addresses.uniswapV3Adapter = A1;
    expect(resolveChainDeployment(8453, { records: { "8453": rec }, useFork: true, env: {} }).swapAdapters).toEqual([]);
  });
});

describe("mainnet-labelled records", () => {
  it("are used without any flag, are not flagged as fork", () => {
    const d = resolveChainDeployment(1, { records: { "1": mainnetLike("ethereum") }, useFork: false, env: {} });
    expect(d.origin).toBe("record");
    expect(d.isFork).toBe(false);
    expect(d.recordSource).toBe("mainnet");
    expect(d.fromBlock).toBe(BigInt(26103768));
    expect(d.fromBlockSource).toBe("blockNumberAtDeploy");
  });
  it("Orbit chains: chain-native blockNumberAtDeploy (record has evmBlockNumberAtDeploy) is used", () => {
    const d = resolveChainDeployment(42161, { records: { "42161": mainnetLike("arbitrum") }, useFork: false, env: {} });
    expect(d.fromBlock).toBe(BigInt(510944643));
  });
  it("Orbit chains, old record shape (no evmBlockNumberAtDeploy): blockNumberAtDeploy is an L1 number and is not trusted; explicit deployBlock is", () => {
    const base = mainnetLike("arbitrum");
    delete base.evmBlockNumberAtDeploy;
    base.blockNumberAtDeploy = 26103733;
    const noBlock = resolveChainDeployment(42161, { records: { "42161": base }, useFork: false, env: {} });
    expect(noBlock.fromBlock).toBeNull();
    expect(noBlock.notes.join(" ")).toMatch(/Orbit/);
    const withBlock = resolveChainDeployment(42161, { records: { "42161": { ...base, deployBlock: 400000000 } }, useFork: false, env: {} });
    expect(withBlock.fromBlock).toBe(BigInt(400000000));
    expect(withBlock.fromBlockSource).toBe("deployBlock");
  });
  it("a mainnet-looking record that is secretly fork-flagged (inconsistent) is treated as fork", () => {
    const rec = mainnetLike("ethereum", { forkBlock: 12 });
    expect(resolveChainDeployment(1, { records: { "1": rec }, useFork: false, env: {} }).fundDeployer).toBeNull();
  });
  it("rejects a record for another chain", () => {
    const rec = mainnetLike("base");
    expect(resolveChainDeployment(1, { records: { "1": rec }, useFork: true, env: {} }).fundDeployer).toBeNull();
  });
});

describe("env overrides", () => {
  it("work with no record at all (explicit opt-in, no flag needed) and are labelled env, not fork", () => {
    const d = resolveChainDeployment(1, { records: {}, useFork: false, env: { 1: { fundDeployer: A1 } } });
    expect(d.fundDeployer).toBe(A1);
    expect(d.origin).toBe("env");
    expect(d.isFork).toBe(false);
    expect(d.denominationAssets.map((a) => a.symbol)).toEqual(["USDC"]);
    expect(d.denominationSource).toBe("fallback");
  });
  it("win over a record: a different FundDeployer supersedes the record entirely (no address mixing)", () => {
    const d = resolveChainDeployment(1, { records: forkRecords, useFork: true, env: { 1: { fundDeployer: A1 } } });
    expect(d.fundDeployer).toBe(A1);
    expect(d.origin).toBe("env");
    expect(d.addresses.valueInterpreter).toBeUndefined();
    expect(d.fromBlock).toBeNull();
    expect(d.notes.join(" ")).toMatch(/superseded/);
  });
  it("same FundDeployer as the record overlays the other env values on the record", () => {
    const fd = (forkRecords["1"] as { addresses: { fundDeployer: string } }).addresses.fundDeployer;
    const d = resolveChainDeployment(1, {
      records: forkRecords, useFork: true,
      env: { 1: { fundDeployer: fd.toLowerCase(), valueInterpreter: A2, deployBlock: "123" } },
    });
    expect(d.origin).toBe("record");
    expect(d.addresses.valueInterpreter).toBe(A2);
    expect(d.fromBlock).toBe(BigInt(123));
    expect(d.fromBlockSource).toBe("env");
    expect(d.addresses.comptrollerLib).toBeDefined();
  });
  it("env FundDeployer works even when the fork record is dropped (useFork=false)", () => {
    const d = resolveChainDeployment(8453, { records: {}, useFork: false, env: { 8453: { fundDeployer: A3 } } });
    expect(d.fundDeployer).toBe(A3);
  });
  it("blank / invalid values are ignored with a note", () => {
    const d = resolveChainDeployment(1, { records: {}, useFork: false, env: { 1: { fundDeployer: "  ", valueInterpreter: "nope" } } });
    expect(d.fundDeployer).toBeNull();
    const d2 = resolveChainDeployment(1, { records: {}, useFork: false, env: { 1: { fundDeployer: "0x123" } } });
    expect(d2.fundDeployer).toBeNull();
    expect(d2.notes.join(" ")).toMatch(/not a valid address/);
  });
  it("NEXT_PUBLIC_DENOMINATION_ASSETS_* replaces the list", () => {
    const d = resolveChainDeployment(1, { records: {}, useFork: false, env: { 1: { fundDeployer: A1, denominationAssets: `DAI:${A2}, ${A3}` } } });
    expect(d.denominationSource).toBe("env");
    expect(d.denominationAssets.map((a) => a.symbol)).toEqual(["DAI", "0x3333…3333"]);
  });
  it("parseDenominationAssetsEnv reports bad entries", () => {
    const r = parseDenominationAssetsEnv(`USDC:${A1},bad,X:0x12`);
    expect(r.assets).toHaveLength(1);
    expect(r.bad).toEqual(["bad", "X:0x12"]);
  });
});

describe("swap adapter eligibility", () => {
  const all = {
    uniswapV3: A1 as `0x${string}`, uniswapV3SwapRouter02: A2 as `0x${string}`, paraSwapV6: A3 as `0x${string}`,
  };
  const kinds = (id: number, a: Parameters<typeof resolveSwapAdapters>[1]) => resolveSwapAdapters(id, a, null).map((r) => r.kind);
  it("Ethereum/Arbitrum: Uniswap first (default), then ParaSwap; the SwapRouter02 adapter is never offered there", () => {
    expect(kinds(1, all)).toEqual(["uniswapV3", "paraSwapV6"]);
    expect(kinds(42161, all)).toEqual(["uniswapV3", "paraSwapV6"]);
    expect(kinds(1, { uniswapV3SwapRouter02: all.uniswapV3SwapRouter02 })).toEqual([]);
  });
  it("Base: SwapRouter02 adapter first, then ParaSwap; the original-router adapter is never offered", () => {
    expect(kinds(8453, all)).toEqual(["uniswapV3SwapRouter02", "paraSwapV6"]);
    expect(kinds(8453, { uniswapV3: all.uniswapV3 })).toEqual([]);
    expect(kinds(8453, { paraSwapV6: all.paraSwapV6 })).toEqual(["paraSwapV6"]);
  });
  it("Robinhood and unknown chains never offer swaps", () => {
    expect(kinds(4663, all)).toEqual([]);
    expect(kinds(999, all)).toEqual([]);
  });
  it("a route is offered only when its adapter address is present; quoter only on Uniswap routes", () => {
    const r = resolveSwapAdapters(1, all, A1 as `0x${string}`);
    expect(r[0]?.quoter).toBe(A1);
    expect(r[1]?.quoter).toBeNull();
    expect(kinds(1, { paraSwapV6: all.paraSwapV6 })).toEqual(["paraSwapV6"]);
  });
  it("adapters absent from the record => no routes (UI shows 'Swaps not enabled on this chain')", () => {
    const d = resolveChainDeployment(1, { records: forkRecords, useFork: true, env: {} });
    expect(d.swapAdapters).toEqual([]);
    expect(d.swapAdapter).toBeNull();
  });
  it("addresses/adapters sections and env produce routes; QuoterV2 defaults to the official address", () => {
    const rec = { ...forkRecords["1"] as object, adapters: { uniswapV3Adapter: { address: A1 } } };
    const d = resolveChainDeployment(1, { records: { "1": rec }, useFork: true, env: {} });
    expect(d.swapAdapter).toMatchObject({ kind: "uniswapV3", address: A1, quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" });
    const b = resolveChainDeployment(8453, { records: {}, useFork: false, env: { 8453: { fundDeployer: A1, uniswapV3SwapRouter02Adapter: A2, uniswapV3Quoter: A3, paraSwapV6Adapter: A1 } } });
    expect(b.swapAdapters.map((r) => r.kind)).toEqual(["uniswapV3SwapRouter02", "paraSwapV6"]);
    expect(b.swapAdapter).toMatchObject({ address: A2, quoter: A3 });
    const b2 = resolveChainDeployment(8453, { records: {}, useFork: false, env: { 8453: { fundDeployer: A1, uniswapV3Adapter: A2 } } });
    expect(b2.swapAdapters).toEqual([]);
  });
});

describe("parseInlinedRecords", () => {
  it("never throws", () => {
    expect(parseInlinedRecords(undefined)).toEqual({});
    expect(parseInlinedRecords("")).toEqual({});
    expect(parseInlinedRecords("{bad")).toEqual({});
    expect(parseInlinedRecords("[1]")).toEqual({});
    expect(parseInlinedRecords('{"1":{"a":1}}')).toEqual({ "1": { a: 1 } });
  });
});

import { getAddress, isAddress, type Address } from "viem";
import { knownUniswapV3Quoters } from "@/config/swap";
import { denominationFallback } from "@/config/tokens";
import { classifyRecord } from "../../../scripts/deployment-records.mjs";
import type {
  ChainDeployment,
  ChainEnvOverrides,
  DenominationAsset,
  FromBlockSource,
  ProtocolAddressKey,
  ProtocolAddressMap,
  RecordSource,
  SwapAdapter,
  SwapAdapterKind,
} from "./types";

/** Chains whose Solidity `block.number` is NOT the chain's own block height (Arbitrum Orbit: returns the L1 number). */
const ORBIT_CHAIN_IDS = new Set([42161, 4663]);

const ADDRESS_KEYS: readonly ProtocolAddressKey[] = [
  "addressListRegistry", "comptrollerLib", "dispatcher", "externalPositionFactory", "externalPositionManager",
  "feeManager", "fundDeployer", "fundValueCalculator", "fundValueCalculatorRouter", "gasRelayPaymasterFactory",
  "globalConfigProxy", "integrationManager", "policyManager", "protocolFeeReserveProxy", "protocolFeeTracker",
  "uintListRegistry", "valueInterpreter", "vaultLib", "uniswapV3Adapter", "uniswapV3SwapRouter02Adapter", "paraSwapV6Adapter",
];

export type LoaderInput = {
  /** Records as inlined by next.config.mjs (already filtered at build time), keyed by chain id. */
  records: Record<string, unknown>;
  /** Mirror of NEXT_PUBLIC_USE_FORK_DEPLOYMENTS (re-checked here as defence in depth). */
  useFork: boolean;
  /** NEXT_PUBLIC_*_<CHAIN> overrides per chain id. */
  env: Record<number, ChainEnvOverrides | undefined>;
};

function asAddress(v: unknown): Address | null {
  return typeof v === "string" && isAddress(v, { strict: false }) ? getAddress(v) : null;
}

/** Accepts `"0x…"` or `{ address: "0x…" }`. */
function asAddressLike(v: unknown): Address | null {
  if (v !== null && typeof v === "object") return asAddress((v as { address?: unknown }).address);
  return asAddress(v);
}

function blankToUndefined(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** `SYM:0xabc…,0xdef…` => list. Entries that are not addresses are reported in `bad`. */
export function parseDenominationAssetsEnv(raw: string | undefined): { assets: DenominationAsset[]; bad: string[] } {
  const assets: DenominationAsset[] = [];
  const bad: string[] = [];
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symOrAddr, maybeAddr] = part.includes(":") ? (part.split(":") as [string, string]) : ["", part];
    const address = asAddress(maybeAddr);
    if (!address) {
      bad.push(part);
      continue;
    }
    assets.push({ symbol: symOrAddr || `${address.slice(0, 6)}…${address.slice(-4)}`, address });
  }
  return { assets, bad };
}

function parseDenominationAssets(rec: Record<string, unknown>, notes: string[]): DenominationAsset[] {
  const out: DenominationAsset[] = [];
  const push = (v: unknown) => {
    if (v === null || typeof v !== "object") return;
    const address = asAddress((v as { address?: unknown }).address);
    const symbol = (v as { symbol?: unknown }).symbol;
    if (!address) {
      notes.push("record has a denominationAsset with an invalid address (skipped)");
      return;
    }
    if (!out.some((a) => a.address === address)) {
      out.push({ symbol: typeof symbol === "string" && symbol ? symbol : address, address });
    }
  };
  if (Array.isArray(rec.denominationAssets)) rec.denominationAssets.forEach(push);
  push(rec.denominationAsset);
  return out;
}

function nonNegInt(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return null;
}

function resolveFromBlock(
  chainId: number,
  rec: Record<string, unknown> | null,
  source: RecordSource | null,
  envRaw: string | undefined,
  notes: string[],
): { block: bigint | null; src: FromBlockSource | null } {
  const e = blankToUndefined(envRaw);
  if (e !== undefined) {
    const b = nonNegInt(e);
    if (b !== null) return { block: b, src: "env" };
    notes.push(`NEXT_PUBLIC_DEPLOY_BLOCK_* is not a non-negative integer ("${e}"); ignored`);
  }
  if (!rec) return { block: null, src: null };
  // An explicit L2-correct block wins.
  const explicit = nonNegInt(rec.deployBlock);
  if (explicit !== null && explicit > BigInt(0)) return { block: explicit, src: "deployBlock" };
  // Fork records: the fork block is on this chain's own numbering and precedes the deployment. `blockNumberAtDeploy`
  // is `block.number` as seen by Solidity, which on Arbitrum Orbit chains is the L1 number (QA finding), so it is never
  // a valid fromBlock there.
  const fork = nonNegInt(rec.forkBlock);
  if (source !== "mainnet" && fork !== null && fork > BigInt(0)) return { block: fork, src: "forkBlock" };
  // deploy-scripts (f5eec49) writes `blockNumberAtDeploy` chain-native and the EVM-visible number separately as
  // `evmBlockNumberAtDeploy`. Older records have no such field: there `blockNumberAtDeploy` is the EVM number, which is only
  // chain-native on non-Orbit chains.
  const atDeploy = nonNegInt(rec.blockNumberAtDeploy);
  const chainNative = rec.evmBlockNumberAtDeploy !== undefined || !ORBIT_CHAIN_IDS.has(chainId);
  if (atDeploy !== null && atDeploy > BigInt(0) && chainNative) {
    return { block: atDeploy, src: "blockNumberAtDeploy" };
  }
  if (!chainNative) {
    notes.push(
      "record has no usable deploy block for this Orbit chain (blockNumberAtDeploy is an L1 number); log scans use a bounded look-back",
    );
  }
  return { block: null, src: null };
}

/**
 * Which swap adapter the UI may use. Strict per-chain eligibility, so a mis-registered adapter cannot be offered:
 *  - Ethereum, Arbitrum: `uniswapV3` (UniswapV3Adapter, original SwapRouter).
 *  - Base: ONLY `uniswapV3SwapRouter02` (PR #4 adapter); the original-router adapter does not match Base's router.
 *  - Robinhood Chain (4663) and every other chain: none (phase 1: swaps off).
 */
export function resolveSwapAdapter(
  chainId: number,
  adapters: Partial<Record<SwapAdapterKind, Address>>,
  quoter: Address | null,
): SwapAdapter | null {
  const kind: SwapAdapterKind | null = chainId === 1 || chainId === 42161 ? "uniswapV3" : chainId === 8453 ? "uniswapV3SwapRouter02" : null;
  if (!kind) return null;
  const address = adapters[kind];
  return address ? { kind, address, quoter } : null;
}

function buildRecordParts(rec: Record<string, unknown>, notes: string[]) {
  const addresses: ProtocolAddressMap = {};
  const raw = (rec.addresses ?? {}) as Record<string, unknown>;
  for (const k of ADDRESS_KEYS) {
    if (raw[k] === undefined) continue;
    const a = asAddress(raw[k]);
    if (a) addresses[k] = a;
    else notes.push(`record addresses.${k} is not a valid address (ignored)`);
  }
  const adapters: Partial<Record<SwapAdapterKind, Address>> = {};
  // Adapter addresses live in `addresses` (as written by the register-adapters deploy step); an `adapters` section is also accepted.
  const rawAdapters = (rec.adapters ?? {}) as Record<string, unknown>;
  const ua = addresses.uniswapV3Adapter ?? asAddressLike(rawAdapters.uniswapV3Adapter);
  const ub = addresses.uniswapV3SwapRouter02Adapter ?? asAddressLike(rawAdapters.uniswapV3SwapRouter02Adapter);
  if (ua) adapters.uniswapV3 = ua;
  if (ub) adapters.uniswapV3SwapRouter02 = ub;
  const ext = (rec.externalContracts ?? {}) as Record<string, unknown>;
  const quoter = asAddressLike(ext.uniswapV3QuoterV2);
  return { addresses, adapters, quoter, denominationAssets: parseDenominationAssets(rec, notes) };
}

/** Pure resolver for one chain (unit-tested). */
export function resolveChainDeployment(chainId: number, input: LoaderInput): ChainDeployment {
  const notes: string[] = [];
  const env = input.env[chainId] ?? {};
  const rawRecord = input.records[String(chainId)];

  // 1) Record, subject to the fork rule (defence in depth: next.config already dropped fork records without the flag).
  let rec: Record<string, unknown> | null = null;
  let source: RecordSource | null = null;
  if (rawRecord !== undefined) {
    const cls = classifyRecord(rawRecord);
    if (cls === "invalid") {
      notes.push("deployment record is malformed (ignored)");
    } else if (cls !== "mainnet" && !input.useFork) {
      notes.push(`${cls} deployment record ignored (NEXT_PUBLIC_USE_FORK_DEPLOYMENTS is off)`);
    } else if ((rawRecord as { chainId?: unknown }).chainId !== chainId) {
      notes.push("deployment record chainId mismatch (ignored)");
    } else {
      rec = rawRecord as Record<string, unknown>;
      source = cls;
    }
  }

  const recParts = rec ? buildRecordParts(rec, notes) : null;
  const envFundDeployer = asAddress(blankToUndefined(env.fundDeployer));
  if (blankToUndefined(env.fundDeployer) && !envFundDeployer) notes.push("NEXT_PUBLIC_FUND_DEPLOYER_* is not a valid address (ignored)");

  // 2) An explicit FundDeployer env override that differs from the record means "a different deployment": the record's
  //    other addresses belong to the old one, so they are NOT mixed in. (Same address => record + env overlay.)
  let useRecord = rec !== null && recParts !== null;
  if (useRecord && envFundDeployer && recParts!.addresses.fundDeployer && recParts!.addresses.fundDeployer !== envFundDeployer) {
    useRecord = false;
    notes.push("deployment record superseded by NEXT_PUBLIC_FUND_DEPLOYER_* (different FundDeployer); other record fields not used");
  }

  const addresses: ProtocolAddressMap = useRecord ? { ...recParts!.addresses } : {};
  const adapters: Partial<Record<SwapAdapterKind, Address>> = useRecord ? { ...recParts!.adapters } : {};
  let quoter: Address | null = useRecord ? recParts!.quoter : null;
  let denominationAssets: DenominationAsset[] = useRecord ? recParts!.denominationAssets : [];
  let denominationSource: ChainDeployment["denominationSource"] = denominationAssets.length > 0 ? "record" : "fallback";

  const overlay = (raw: string | undefined, name: string): Address | null => {
    const t = blankToUndefined(raw);
    if (t === undefined) return null;
    const a = asAddress(t);
    if (!a) {
      notes.push(`${name} is not a valid address (ignored)`);
      return null;
    }
    return a;
  };
  if (envFundDeployer) {
    addresses.fundDeployer = envFundDeployer;
  }
  const vi = overlay(env.valueInterpreter, "NEXT_PUBLIC_VALUE_INTERPRETER_*");
  if (vi) addresses.valueInterpreter = vi;
  const fvc = overlay(env.fundValueCalculatorRouter, "NEXT_PUBLIC_FUND_VALUE_CALCULATOR_ROUTER_*");
  if (fvc) addresses.fundValueCalculatorRouter = fvc;
  const a1 = overlay(env.uniswapV3Adapter, "NEXT_PUBLIC_UNISWAP_V3_ADAPTER_*");
  if (a1) adapters.uniswapV3 = a1;
  const a2 = overlay(env.uniswapV3SwapRouter02Adapter, "NEXT_PUBLIC_UNISWAP_V3_SWAPROUTER02_ADAPTER_*");
  if (a2) adapters.uniswapV3SwapRouter02 = a2;
  const q = overlay(env.uniswapV3Quoter, "NEXT_PUBLIC_UNISWAP_V3_QUOTER_*");
  if (q) quoter = q;
  const envDenoms = parseDenominationAssetsEnv(blankToUndefined(env.denominationAssets));
  for (const b of envDenoms.bad) notes.push(`NEXT_PUBLIC_DENOMINATION_ASSETS_*: "${b}" is not an address (ignored)`);
  if (envDenoms.assets.length > 0) {
    denominationAssets = envDenoms.assets;
    denominationSource = "env";
  }

  const fundDeployer = addresses.fundDeployer ?? null;
  if (!fundDeployer) {
    // Nothing usable: do not expose half a deployment.
    return {
      chainId, origin: "none", recordSource: null, isFork: false, addresses: {}, fundDeployer: null,
      denominationAssets: [], denominationSource: "fallback", fromBlock: null, fromBlockSource: null, adapters: {}, quoter: null, swapAdapter: null, notes,
    };
  }

  // 3) Quoter fallback to the official address; fromBlock; swap eligibility.
  const effQuoter = quoter ?? knownUniswapV3Quoters[chainId] ?? null;
  const fb = resolveFromBlock(chainId, useRecord ? rec : null, useRecord ? source : null, env.deployBlock, notes);
  const swapAdapter = resolveSwapAdapter(chainId, adapters, effQuoter);
  const origin = useRecord ? "record" : "env";
  if (denominationAssets.length === 0) {
    // No list in record/env: fall back to the app's verified token list (informational quick-picks).
    denominationAssets = denominationFallback(chainId).map((t) => ({ symbol: t.symbol, address: t.address }));
    denominationSource = "fallback";
  }
  return {
    chainId,
    origin,
    recordSource: useRecord ? source : null,
    isFork: useRecord && source !== "mainnet",
    addresses,
    fundDeployer,
    denominationAssets,
    denominationSource,
    fromBlock: fb.block,
    fromBlockSource: fb.src,
    adapters,
    quoter: effQuoter,
    swapAdapter,
    notes,
  };
}

export function resolveAllDeployments(chainIds: readonly number[], input: LoaderInput): Record<number, ChainDeployment> {
  return Object.fromEntries(chainIds.map((id) => [id, resolveChainDeployment(id, input)]));
}

/** Parses the build-time JSON inlined by next.config.mjs; malformed input yields no records (never throws). */
export function parseInlinedRecords(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v: unknown = JSON.parse(json);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

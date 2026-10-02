import type { Address } from "viem";

/**
 * "My portfolios" without an indexer: `FundDeployer.NewFundCreated(address indexed creator, address vaultProxy,
 * address comptrollerProxy)` logs filtered by the connected account as `creator`, paged in block-range chunks because public
 * RPCs cap eth_getLogs ranges (and sometimes result sizes).
 *
 * NOTE `creator` is msg.sender of createNewFund, not the fund owner: a vault created by someone else for you as owner is not
 * found this way (use the paste-a-vault fallback).
 */

export type FoundVault = { vault: Address; comptroller: Address; blockNumber: bigint };

export type PagedScanResult = {
  logs: FoundVault[];
  /** true if [fromBlock, toBlock] was scanned completely */
  complete: boolean;
  /** lowest block successfully scanned (== fromBlock when complete) */
  scannedFrom: bigint;
  requests: number;
  error?: string;
};

export type PagedScanOptions = {
  fromBlock: bigint;
  toBlock: bigint;
  /** fetches logs for an inclusive range; throws on RPC range/size errors */
  fetchRange: (from: bigint, to: bigint) => Promise<FoundVault[]>;
  initialChunk?: bigint;
  minChunk?: bigint;
  maxChunk?: bigint;
  /** hard cap on RPC calls */
  maxRequests?: number;
  signal?: { aborted: boolean };
  onProgress?: (p: { scannedFrom: bigint; toBlock: bigint; found: number }) => void;
};

/**
 * Scans newest -> oldest so recent portfolios show first even if the scan stops early. A failing range is retried with half the
 * chunk (down to minChunk, after which the scan stops with `error`); a successful one grows the chunk by 2x up to maxChunk.
 */
export async function scanLogsPaged(o: PagedScanOptions): Promise<PagedScanResult> {
  const minChunk = o.minChunk ?? BigInt(500);
  const maxChunk = o.maxChunk ?? BigInt(1_000_000);
  const maxRequests = o.maxRequests ?? 400;
  let chunk = o.initialChunk ?? BigInt(50_000);
  if (chunk > maxChunk) chunk = maxChunk;
  const found = new Map<string, FoundVault>();
  let hi = o.toBlock;
  let requests = 0;
  let error: string | undefined;
  while (hi >= o.fromBlock) {
    if (o.signal?.aborted) { error = "aborted"; break; }
    if (requests >= maxRequests) { error = `stopped after ${maxRequests} requests`; break; }
    const lo = hi - chunk + BigInt(1) > o.fromBlock ? hi - chunk + BigInt(1) : o.fromBlock;
    requests++;
    try {
      for (const l of await o.fetchRange(lo, hi)) found.set(l.vault.toLowerCase(), l);
      hi = lo - BigInt(1);
      if (chunk < maxChunk) chunk = chunk * BigInt(2) > maxChunk ? maxChunk : chunk * BigInt(2);
      o.onProgress?.({ scannedFrom: lo, toBlock: o.toBlock, found: found.size });
    } catch (e) {
      if (chunk <= minChunk) {
        error = `RPC rejected eth_getLogs even for ${chunk} blocks: ${(e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e}`.split("\n")[0];
        break;
      }
      chunk = chunk / BigInt(2) < minChunk ? minChunk : chunk / BigInt(2);
    }
  }
  const complete = hi < o.fromBlock;
  return {
    logs: [...found.values()].sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1)),
    complete,
    scannedFrom: hi + BigInt(1),
    requests,
    error: complete ? undefined : error,
  };
}

/** Bounded look-back (blocks) when the deployment record gives no usable start block. Roughly 1-2 months per chain. */
export const DEFAULT_LOOKBACK_BLOCKS: Record<number, bigint> = {
  1: BigInt(400_000),
  8453: BigInt(2_500_000),
  42161: BigInt(40_000_000),
  4663: BigInt(40_000_000),
  999: BigInt(5_000_000), // HyperEVM: ~1 s blocks
};

export function scanStartBlock(chainId: number, fromBlock: bigint | null, latest: bigint): { from: bigint; bounded: boolean } {
  if (fromBlock !== null) return { from: fromBlock > latest ? latest : fromBlock, bounded: false };
  const back = DEFAULT_LOOKBACK_BLOCKS[chainId] ?? BigInt(1_000_000);
  return { from: latest > back ? latest - back : BigInt(0), bounded: true };
}

// ---- saved vaults (the paste fallback; localStorage, per chain) --------------------------------------------------------

const KEY = "onchain-portfolio:saved-vaults:v1";

export type SavedVaults = Record<string, string[]>;

export function parseSaved(raw: string | null): SavedVaults {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    const out: SavedVaults = {};
    for (const [k, list] of Object.entries(v)) {
      if (Array.isArray(list)) out[k] = list.filter((a): a is string => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a));
    }
    return out;
  } catch {
    return {};
  }
}

export function addSaved(saved: SavedVaults, chainId: number, vault: string): SavedVaults {
  const key = String(chainId);
  const list = saved[key] ?? [];
  if (list.some((a) => a.toLowerCase() === vault.toLowerCase())) return saved;
  return { ...saved, [key]: [vault, ...list].slice(0, 50) };
}

export function removeSaved(saved: SavedVaults, chainId: number, vault: string): SavedVaults {
  const key = String(chainId);
  return { ...saved, [key]: (saved[key] ?? []).filter((a) => a.toLowerCase() !== vault.toLowerCase()) };
}

export function loadSavedVaults(): SavedVaults {
  if (typeof window === "undefined") return {};
  try {
    return parseSaved(window.localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

export function storeSavedVaults(saved: SavedVaults): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    /* storage unavailable (private mode / quota): the list just won't persist */
  }
}

import type { SupportedChainId } from "./chains";

export type Feature = "create" | "deposit" | "redeem" | "swap";

export type FeatureFlags = Record<Feature, boolean>;

/**
 * Per-chain feature flags. These gate the UI only; the contracts are the source of truth.
 *
 * Robinhood Chain is staged (see research/chain-feasibility.md §0, §4): phase 1 is vault creation
 * plus deposit/redeem. Swaps stay off until ParaSwap v6 (phase 2) and a SwapRouter02-compatible
 * Uniswap v3 adapter (phase 3) are deployed and fork-tested.
 *
 * Base: swap is on for the ParaSwap v6 / 1inch v5 adapters only; the repo's UniswapV3Adapter does not
 * match Base's SwapRouter02 and must not be offered there.
 */
export const featureFlags: Record<SupportedChainId, FeatureFlags> = {
  1: { create: true, deposit: true, redeem: true, swap: true },
  8453: { create: true, deposit: true, redeem: true, swap: true },
  42161: { create: true, deposit: true, redeem: true, swap: true },
  4663: { create: true, deposit: true, redeem: true, swap: false },
};

export function isFeatureEnabled(chainId: number | undefined, feature: Feature): boolean {
  if (chainId === undefined) return false;
  const flags = (featureFlags as Record<number, FeatureFlags | undefined>)[chainId];
  return flags?.[feature] ?? false;
}

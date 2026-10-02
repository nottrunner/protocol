import type { Address } from "viem";

export type KnownToken = { symbol: string; address: Address; decimals: number; note?: string; denomination?: boolean };

/**
 * Verified token addresses (config/chains/*.json on feat/deploy-scripts: on-chain symbol/decimals reads on 2026-10-01;
 * Robinhood per docs.robinhood.com/chain/contracts). `denomination: true` marks the asset the deploy script registers as
 * the chain's denomination primitive. Users can paste other addresses where the form allows it.
 * Do NOT add the token labelled "USDC" at 0x378F…8030 on Robinhood Chain: it is 18 decimals and not Circle USDC.
 */
export const knownTokens: Record<number, KnownToken[]> = {
  1: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, note: "Circle native USDC", denomination: true },
    { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  ],
  8453: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, note: "Circle native USDC", denomination: true },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  ],
  42161: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, note: "Circle native USDC", denomination: true },
    { symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
  ],
  4663: [
    { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, note: "Paxos USDG", denomination: true },
    { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18, note: "aeWETH" },
  ],
};

export function tokensFor(chainId: number): KnownToken[] {
  return knownTokens[chainId] ?? [];
}

/** Denomination quick-picks used when neither the deployment record nor env lists allowed denomination assets. */
export function denominationFallback(chainId: number): KnownToken[] {
  return tokensFor(chainId).filter((t) => t.denomination);
}

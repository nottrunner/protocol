import type { Address } from "viem";

export type KnownToken = { symbol: string; address: Address; decimals: number; note?: string };

/**
 * Only addresses verified in research/chain-feasibility.md (docs.robinhood.com/chain/contracts + on-chain reads).
 * Other chains: TODO add after verifying against the canonical token lists; users can paste any address.
 * Do NOT add the token labelled "USDC" at 0x378F…8030 on Robinhood Chain: it is 18 decimals and unverified.
 */
export const knownTokens: Record<number, KnownToken[]> = {
  4663: [
    { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, note: "Paxos USDG" },
    { symbol: "WETH", address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", decimals: 18, note: "aeWETH" },
  ],
};

export function tokensFor(chainId: number): KnownToken[] {
  return knownTokens[chainId] ?? [];
}

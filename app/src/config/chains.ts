import { defineChain, type Chain } from "viem";
import { arbitrum, base, mainnet } from "viem/chains";
import { rpcUrls } from "./rpc";

/**
 * Robinhood Chain (Arbitrum Orbit L2, mainnet live since 2026-07-01).
 * Verified: chain id 4663 (eth_chainId = 0x1237), gas token ETH (18 decimals),
 * RPC (override: NEXT_PUBLIC_RPC_URL_ROBINHOOD, see rpc.ts) + explorer per https://docs.robinhood.com/chain/add-network-to-wallet/.
 * No multicall3 entry is set: do not assume one until verified for this chain.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrls.robinhood] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/**
 * HyperEVM (Hyperliquid), chain id 999. Verified: eth_chainId = 0x3e7 on https://rpc.hyperliquid.xyz/evm (2026-10-02),
 * gas token HYPE (18 decimals; https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm).
 * RPC override: NEXT_PUBLIC_RPC_URL_HYPEREVM (see rpc.ts). Explorer: https://hyperevmscan.io (Etherscan-family).
 * No multicall3 entry is set: do not assume one until verified for this chain.
 * Dual-block chain: contract deployments of our core need big blocks (see research/chain-feasibility.md §9); the app only
 * sends vault/deposit/redeem transactions, which fit in 3M-gas small blocks.
 */
export const hyperEvmChain = defineChain({
  id: 999,
  name: "HyperEVM",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: [rpcUrls.hyperevm] },
  },
  blockExplorers: {
    default: { name: "HyperEVMScan", url: "https://hyperevmscan.io" },
  },
});

export const ethereumChain = { ...mainnet, rpcUrls: { default: { http: [rpcUrls.ethereum] } } } as const satisfies Chain;
export const baseChain = { ...base, rpcUrls: { default: { http: [rpcUrls.base] } } } as const satisfies Chain;
export const arbitrumChain = { ...arbitrum, rpcUrls: { default: { http: [rpcUrls.arbitrum] } } } as const satisfies Chain;

export const supportedChains = [ethereumChain, baseChain, arbitrumChain, robinhoodChain, hyperEvmChain] as const;

export type SupportedChain = (typeof supportedChains)[number];
export type SupportedChainId = SupportedChain["id"];

export const supportedChainIds: readonly number[] = supportedChains.map((c) => c.id);

export function isSupportedChainId(id: number | undefined): id is SupportedChainId {
  return id !== undefined && supportedChainIds.includes(id);
}

export function getChain(id: number): SupportedChain | undefined {
  return supportedChains.find((c) => c.id === id);
}

export function explorerUrl(chainId: number, path: string = ""): string | undefined {
  const base = getChain(chainId)?.blockExplorers?.default.url;
  return base ? `${base}${path}` : undefined;
}

/** URL slugs for /portfolio/<chain>/<vault>. */
export const chainSlugs: Record<SupportedChainId, string> = {
  1: "ethereum",
  8453: "base",
  42161: "arbitrum",
  4663: "robinhood",
  999: "hyperevm",
};

export function chainSlug(chainId: number): string | undefined {
  return (chainSlugs as Record<number, string | undefined>)[chainId];
}

/** Accepts a slug ("base") or a numeric chain id ("8453"); returns the supported chain id or undefined. */
export function chainIdFromParam(param: string | undefined): SupportedChainId | undefined {
  if (!param) return undefined;
  const p = decodeURIComponent(param).toLowerCase();
  const bySlug = (Object.entries(chainSlugs) as [string, string][]).find(([, slug]) => slug === p);
  if (bySlug) return Number(bySlug[0]) as SupportedChainId;
  const n = Number(p);
  return Number.isInteger(n) && isSupportedChainId(n) ? n : undefined;
}

export function portfolioPath(chainId: number, vault: string): string {
  return `/portfolio/${chainSlug(chainId) ?? chainId}/${vault}`;
}

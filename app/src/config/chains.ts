import { defineChain, type Chain } from "viem";
import { arbitrum, base, mainnet } from "viem/chains";

/**
 * Public default RPC endpoints. Each was checked with `eth_chainId` on 2026-10-01 (see
 * research/chain-feasibility.md). They are rate-limited: set NEXT_PUBLIC_RPC_URL_* in
 * production. NOTE: NEXT_PUBLIC_* vars must be referenced statically so Next can inline them.
 */
const RPC_URLS = {
  ethereum: process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM || "https://ethereum-rpc.publicnode.com",
  base: process.env.NEXT_PUBLIC_RPC_URL_BASE || "https://mainnet.base.org",
  arbitrum: process.env.NEXT_PUBLIC_RPC_URL_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  robinhood: process.env.NEXT_PUBLIC_RPC_URL_ROBINHOOD || "https://rpc.mainnet.chain.robinhood.com",
} as const;

/**
 * Robinhood Chain (Arbitrum Orbit L2, mainnet live since 2026-07-01).
 * Verified: chain id 4663 (eth_chainId = 0x1237), gas token ETH (18 decimals),
 * RPC + explorer per https://docs.robinhood.com/chain/add-network-to-wallet/.
 * No multicall3 entry is set: do not assume one until verified for this chain.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URLS.robinhood] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const ethereumChain = { ...mainnet, rpcUrls: { default: { http: [RPC_URLS.ethereum] } } } as const satisfies Chain;
export const baseChain = { ...base, rpcUrls: { default: { http: [RPC_URLS.base] } } } as const satisfies Chain;
export const arbitrumChain = { ...arbitrum, rpcUrls: { default: { http: [RPC_URLS.arbitrum] } } } as const satisfies Chain;

export const supportedChains = [ethereumChain, baseChain, arbitrumChain, robinhoodChain] as const;

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

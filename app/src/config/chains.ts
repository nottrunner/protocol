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

export const ethereumChain = { ...mainnet, rpcUrls: { default: { http: [rpcUrls.ethereum] } } } as const satisfies Chain;
export const baseChain = { ...base, rpcUrls: { default: { http: [rpcUrls.base] } } } as const satisfies Chain;
export const arbitrumChain = { ...arbitrum, rpcUrls: { default: { http: [rpcUrls.arbitrum] } } } as const satisfies Chain;

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

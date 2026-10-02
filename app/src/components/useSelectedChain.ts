"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { getChain, isSupportedChainId, supportedChains } from "@/config/chains";
import { isFeatureEnabled, type Feature } from "@/config/features";

// Tiny external store so the header switcher and pages share the "read chain" when no wallet is connected.
let readChainId: number = supportedChains[0].id;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => readChainId;

export function useSelectedChain() {
  const { chainId: walletChainId, isConnected } = useAccount();
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const chainId = isConnected && walletChainId !== undefined ? walletChainId : stored;
  return {
    chainId,
    chain: getChain(chainId),
    isSupported: isSupportedChainId(chainId),
    setReadChainId: (id: number) => {
      readChainId = id;
      listeners.forEach((l) => l());
    },
    /** Feature flag for `forChainId` (pages bound to a URL chain pass it); defaults to the wallet / selected chain. */
    can: (feature: Feature, forChainId?: number) => isFeatureEnabled(forChainId ?? chainId, feature),
  };
}

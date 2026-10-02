"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { supportedChains } from "@/config/chains";
import { useSelectedChain } from "./useSelectedChain";

/**
 * Dropdown for the four supported chains. Connected: switches the wallet chain.
 * Not connected: only changes which chain the app reads from (stored in the URL-less local state).
 */
export function ChainSwitcher() {
  const { isConnected } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const { chainId, setReadChainId, isSupported } = useSelectedChain();

  return (
    <label className="chain-switcher">
      <span className="sr-only">Network</span>
      <select
        aria-label="Network"
        value={isSupported ? chainId : ""}
        disabled={isPending}
        onChange={async (e) => {
          const next = Number(e.target.value);
          setReadChainId(next);
          if (isConnected) {
            try {
              await switchChainAsync({ chainId: next });
            } catch {
              // user rejected, or wallet cannot add the chain: keep UI on the wallet's chain
            }
          }
        }}
      >
        {!isSupported && <option value="">Unsupported network</option>}
        {supportedChains.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}

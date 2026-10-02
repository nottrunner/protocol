"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { getChain } from "@/config/chains";
import { errorMessage } from "@/lib/contracts";
import { useState } from "react";
import { Notice } from "./Notice";

/** For pages bound to a URL chain: when the wallet sits on another chain, writes need a switch first. */
export function WalletChainGate({ chainId }: { chainId: number }) {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const [err, setErr] = useState<string>();
  if (!isConnected || walletChainId === chainId) return null;
  return (
    <Notice kind="warn">
      Your wallet is on {getChain(walletChainId ?? 0)?.name ?? `chain ${walletChainId}`}; this portfolio is on{" "}
      {getChain(chainId)?.name}.{" "}
      <button
        className="btn"
        type="button"
        disabled={isPending}
        onClick={async () => {
          setErr(undefined);
          try { await switchChainAsync({ chainId }); } catch (e) { setErr(errorMessage(e)); }
        }}
      >
        Switch wallet to {getChain(chainId)?.name}
      </button>
      {err && <> {err}</>}
    </Notice>
  );
}

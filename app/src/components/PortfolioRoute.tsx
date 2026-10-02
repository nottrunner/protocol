"use client";

import { chainIdFromParam } from "@/config/chains";
import { Notice } from "./Notice";
import { PortfolioView } from "./PortfolioView";

export function PortfolioRoute({ chainParam, vault }: { chainParam: string; vault: string }) {
  const chainId = chainIdFromParam(chainParam);
  return (
    <>
      <h1>Portfolio</h1>
      {chainId === undefined
        ? <Notice kind="error">Unknown network &quot;{chainParam}&quot;. Use ethereum, base, arbitrum or robinhood.</Notice>
        : <PortfolioView chainId={chainId} vault={vault} />}
    </>
  );
}

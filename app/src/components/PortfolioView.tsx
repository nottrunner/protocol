"use client";

import { useEffect } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { explorerUrl, getChain } from "@/config/chains";
import { formatAmount, shortAddress } from "@/lib/format";
import { addSaved, loadSavedVaults, storeSavedVaults, usePortfolio, useValuation } from "@/lib/contracts";
import { DeploymentNotices } from "./DeploymentNotices";
import { DepositCard } from "./DepositCard";
import { Notice } from "./Notice";
import { RedeemCard } from "./RedeemCard";
import { SwapCard } from "./SwapCard";
import { useSelectedChain } from "./useSelectedChain";
import { WalletChainGate } from "./WalletChainGate";

/** Portfolio page body for /portfolio/<chain>/<vault>. All reads use the URL's chain, so a reload renders the same page. */
export function PortfolioView({ chainId, vault }: { chainId: number; vault: string }) {
  const { isConnected, chainId: walletChainId } = useAccount();
  const { setReadChainId, can } = useSelectedChain();
  const chain = getChain(chainId);
  const p = usePortfolio(chainId, vault);
  const valuation = useValuation(chainId, p.data);

  useEffect(() => {
    setReadChainId(chainId);
  }, [chainId, setReadChainId]);

  // Remember opened vaults so they show up under "My portfolios" (paste fallback / vaults created elsewhere).
  useEffect(() => {
    if (p.data) storeSavedVaults(addSaved(loadSavedVaults(), chainId, p.data.vault));
  }, [p.data, chainId]);

  if (!isAddress(vault)) return <Notice kind="error">Invalid vault address.</Notice>;
  const walletOnChain = !isConnected || walletChainId === chainId;
  const d = p.data;
  const v = valuation.data;
  const dd = d?.denomination.decimals ?? 18;

  return (
    <>
      <p className="muted small">Network: <strong>{chain?.name}</strong></p>
      <DeploymentNotices chainId={chainId} />
      <WalletChainGate chainId={chainId} />
      {p.isLoading && <p className="muted">Loading…</p>}
      {!p.isLoading && p.isError && (
        <Notice kind="error">No vault found at this address on {chain?.name}. Check the address and network.</Notice>
      )}

      {d && (
        <div className="card" data-testid="portfolio">
          <h2>
            <span data-testid="portfolio-name">{d.name}</span> <span className="muted">(<span data-testid="portfolio-symbol">{d.symbol}</span>)</span>
          </h2>
          <dl className="dl">
            <dt>Vault</dt>
            <dd data-testid="portfolio-vault">
              {explorerUrl(chainId, `/address/${d.vault}`)
                ? <a href={explorerUrl(chainId, `/address/${d.vault}`)} target="_blank" rel="noreferrer">{d.vault}</a>
                : d.vault}
            </dd>
            <dt>Comptroller</dt><dd data-testid="portfolio-comptroller">{d.comptroller}</dd>
            <dt>Owner</dt><dd data-testid="portfolio-owner">{d.owner}</dd>
            <dt>Denomination</dt><dd data-testid="portfolio-denomination">{d.denomination.symbol} ({shortAddress(d.denomination.address)})</dd>
            <dt>Total shares</dt><dd data-testid="portfolio-total-shares">{formatAmount(d.totalSupply, 18)}</dd>
            <dt>Your shares</dt>
            <dd data-testid="portfolio-your-shares">{d.account ? formatAmount(d.account.shares, 18) : "Connect wallet"}</dd>
            <dt>Share price</dt>
            <dd data-testid="portfolio-share-price">
              {valuation.isLoading && "…"}
              {v && (v.netSharePrice ?? v.grossSharePrice) !== undefined
                ? `${formatAmount((v.netSharePrice ?? v.grossSharePrice) as bigint, dd)} ${d.denomination.symbol}${v.netSharePrice === undefined ? " (gross)" : ""}`
                : !valuation.isLoading && "unavailable"}
            </dd>
            <dt>NAV</dt>
            <dd data-testid="portfolio-nav">
              {valuation.isLoading && "…"}
              {v && (v.nav ?? v.gav) !== undefined
                ? `${formatAmount((v.nav ?? v.gav) as bigint, dd)} ${d.denomination.symbol}${v.nav === undefined ? " (GAV)" : ""}`
                : !valuation.isLoading && "unavailable"}
            </dd>
          </dl>
          {v && v.errors.length > 0 && <Notice kind="warn">{v.errors.join(" · ")}</Notice>}

          <h3>Holdings</h3>
          <table className="table" data-testid="holdings">
            <thead><tr><th>Asset</th><th>Balance</th><th>Value ({d.denomination.symbol})</th></tr></thead>
            <tbody>
              {d.holdings.length === 0 && <tr><td colSpan={3}>No tracked assets</td></tr>}
              {d.holdings.map((h) => (
                <tr key={h.address} data-testid={`holding-${h.symbol}`}>
                  <td>{h.symbol} <span className="muted small">{shortAddress(h.address)}</span></td>
                  <td data-testid={`holding-balance-${h.symbol}`}>{formatAmount(h.balance, h.decimals)}</td>
                  <td>{v?.assetValues[h.address.toLowerCase()] !== undefined ? formatAmount(v.assetValues[h.address.toLowerCase()], dd) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="grid">
            {can("deposit") ? (
              <DepositCard portfolio={d} disabled={!walletOnChain} onDone={() => { void p.refetch(); void valuation.refetch(); }} />
            ) : (
              <Notice kind="info">Deposits are not enabled on {chain?.name}.</Notice>
            )}
            {can("redeem") ? (
              <RedeemCard portfolio={d} disabled={!walletOnChain} onDone={() => { void p.refetch(); void valuation.refetch(); }} />
            ) : (
              <Notice kind="info">Redemptions are not enabled on {chain?.name}.</Notice>
            )}
          </div>

          <SwapCard portfolio={d} disabled={!walletOnChain} onDone={() => { void p.refetch(); void valuation.refetch(); }} />
        </div>
      )}
    </>
  );
}

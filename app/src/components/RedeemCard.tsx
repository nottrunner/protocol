"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { formatAmount, safeParseUnits, shortAddress } from "@/lib/format";
import { errorMessage, previewInKindRedemption, useRedeem, type PortfolioData, type RedeemFlowResult } from "@/lib/contracts";
import { Notice } from "./Notice";

type Mode = "inKind" | "denomination";

export function RedeemCard({ portfolio, disabled, onDone }: { portfolio: PortfolioData; disabled?: boolean; onDone: () => unknown }) {
  const { address, isConnected } = useAccount();
  const { chainId, vault, comptroller, denomination, holdings } = portfolio;
  const { redeem, pending } = useRedeem(chainId, vault, comptroller);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("inKind");
  const [result, setResult] = useState<RedeemFlowResult & { before: PortfolioData["holdings"] }>();
  const [error, setError] = useState<string>();

  const shares = portfolio.account?.shares;
  const parsed = safeParseUnits(amount, 18);
  const tooMuch = parsed !== undefined && shares !== undefined && parsed > shares;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const locked = portfolio.account !== undefined && portfolio.account.lockedUntil > now;
  const preview = parsed && !tooMuch && mode === "inKind" ? previewInKindRedemption(holdings, parsed, portfolio.totalSupply) : [];
  const symbolOf = (a: string) => holdings.find((h) => h.address.toLowerCase() === a.toLowerCase());

  return (
    <div className="card inner" data-testid="redeem-card">
      <h3>Redeem</h3>
      <p className="muted small" data-testid="redeem-balance">Your shares: {formatAmount(shares, 18)}</p>
      <div className="row">
        <input
          className="grow" name="redeemShares" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Shares"
          inputMode="decimal" aria-label="Shares to redeem"
        />
        <button type="button" className="chip" disabled={shares === undefined} onClick={() => shares !== undefined && setAmount(formatAmount(shares, 18, 18))}>Max</button>
      </div>
      {tooMuch && <span className="field-error">Exceeds your share balance</span>}
      <label className="small">Payout
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Redemption mode">
          <option value="inKind">In kind (all tracked assets, pro rata)</option>
          <option value="denomination">Single asset: {denomination.symbol} (priced via ValueInterpreter)</option>
        </select>
      </label>
      {preview.length > 0 && (
        <ul className="small muted" data-testid="redeem-preview">
          {preview.map((p) => <li key={p.asset.address}>≈ {formatAmount(p.amount, p.asset.decimals)} {p.asset.symbol}</li>)}
        </ul>
      )}
      {locked && <Notice kind="warn">Shares action timelock: redemption is locked until {new Date(Number(portfolio.account!.lockedUntil) * 1000).toLocaleString()}.</Notice>}
      <button
        className="btn"
        disabled={disabled || !isConnected || !parsed || parsed === BigInt(0) || tooMuch || pending || !address}
        onClick={async () => {
          setError(undefined);
          setResult(undefined);
          try {
            const redemption =
              mode === "inKind"
                ? ({ mode: "inKind", recipient: address!, shares: parsed as bigint } as const)
                : ({ mode: "specific", recipient: address!, shares: parsed as bigint, assets: [denomination.address], percentagesBps: [10_000] } as const);
            const r = await redeem(redemption);
            setResult({ ...r, before: holdings });
            setAmount("");
            await onDone();
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        {pending ? "Redeeming…" : mode === "inKind" ? "Redeem in kind" : `Redeem to ${denomination.symbol}`}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          <div data-testid="redeem-result">
            Redeemed {formatAmount(result.sharesRedeemed, 18)} shares. Received:
            <ul>
              {result.assets.map((a, i) => {
                const h = symbolOf(a) ?? (a.toLowerCase() === denomination.address.toLowerCase() ? denomination : undefined);
                return (
                  <li key={a} data-testid={`redeem-payout-${h?.symbol ?? a}`}>
                    {formatAmount(result.amounts[i], h?.decimals ?? 18)} {h?.symbol ?? shortAddress(a)}
                  </li>
                );
              })}
            </ul>
          </div>
        </Notice>
      )}
    </div>
  );
}

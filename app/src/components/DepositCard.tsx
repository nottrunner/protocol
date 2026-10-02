"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { formatAmount, safeParseUnits } from "@/lib/format";
import { errorMessage, useDeposit, useDepositQuote, useTokenBalance, type DepositFlowResult, type PortfolioData } from "@/lib/contracts";
import { Notice } from "./Notice";

const SLIPPAGE_OPTIONS = [10, 50, 100, 300]; // bps

export function DepositCard({ portfolio, disabled, onDone }: { portfolio: PortfolioData; disabled?: boolean; onDone: () => unknown }) {
  const { isConnected } = useAccount();
  const { chainId, vault, comptroller, denomination } = portfolio;
  const { deposit, pending } = useDeposit(chainId, vault, comptroller, denomination.address);
  const token = useTokenBalance(chainId, denomination.address);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [result, setResult] = useState<DepositFlowResult>();
  const [error, setError] = useState<string>();
  const parsed = safeParseUnits(amount, denomination.decimals);
  const quote = useDepositQuote(chainId, comptroller, parsed, slippage);
  const insufficient = parsed !== undefined && token.balance !== undefined && parsed > token.balance;

  return (
    <div className="card inner" data-testid="deposit-card">
      <h3>Deposit</h3>
      <p className="muted small" data-testid="deposit-balance">
        Balance: {formatAmount(token.balance, denomination.decimals)} {denomination.symbol}
      </p>
      <input
        name="depositAmount" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Amount (${denomination.symbol})`}
        inputMode="decimal" aria-label="Deposit amount"
      />
      {insufficient && <span className="field-error">Exceeds your {denomination.symbol} balance</span>}
      <label className="small">Slippage on shares
        <select value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} aria-label="Deposit slippage">
          {SLIPPAGE_OPTIONS.map((b) => <option key={b} value={b}>{b / 100}%</option>)}
        </select>
      </label>
      {quote.data && (
        <p className="muted small" data-testid="deposit-quote">
          Share price {formatAmount(quote.data.sharePrice, denomination.decimals)} {denomination.symbol} · expect ≈{" "}
          {formatAmount(quote.data.expectedShares, 18)} shares · min {formatAmount(quote.data.minShares, 18)} (minSharesQuantity)
        </p>
      )}
      {quote.isError && parsed && <Notice kind="warn">Could not quote the share price: {errorMessage(quote.error)}</Notice>}
      {portfolio.account && portfolio.sharesActionTimelock > BigInt(0) && (
        <p className="muted small">Shares-action timelock: {portfolio.sharesActionTimelock.toString()}s (buying locks redemption).</p>
      )}
      <button
        className="btn"
        disabled={disabled || !isConnected || !parsed || parsed === BigInt(0) || insufficient || pending}
        onClick={async () => {
          setError(undefined);
          setResult(undefined);
          try {
            setResult(await deposit(parsed as bigint, slippage));
            setAmount("");
            await Promise.all([onDone(), token.refetch()]);
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      >
        {pending ? "Depositing…" : !isConnected ? "Connect wallet" : "Approve & deposit"}
      </button>
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          <span data-testid="deposit-result">Deposit confirmed: received {formatAmount(result.sharesReceived, 18)} shares (min {formatAmount(result.minShares, 18)}).</span>
        </Notice>
      )}
    </div>
  );
}

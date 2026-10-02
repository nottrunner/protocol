"use client";

import { useMemo, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { explorerUrl } from "@/config/chains";
import { tokensFor } from "@/config/tokens";
import { formatAmount, safeParseUnits, shortAddress } from "@/lib/format";
import {
  errorMessage, SwapSimulationError, useDeployment, useSwap, useTokenInfo, type PortfolioData, type PreparedSwap, type SwapFlowResult, type TokenInfo,
} from "@/lib/contracts";
import { Notice } from "./Notice";

const SLIPPAGE_OPTIONS = [10, 50, 100, 300]; // bps
const OTHER = "other";

type ShownResult = SwapFlowResult & { shownIn: TokenInfo; shownOut: TokenInfo };

/**
 * Swap UI (AC-4). Shown only where the chain's deployment lists at least one eligible adapter; the route (adapter) is
 * selectable (Uniswap default, ParaSwap alternative) and the result states which adapter ran.
 */
export function SwapCard({ portfolio, disabled, onDone }: { portfolio: PortfolioData; disabled?: boolean; onDone: () => unknown }) {
  const { chainId } = portfolio;
  const deployment = useDeployment(chainId);
  const routes = deployment.swapAdapters;
  const { isConnected } = useAccount();
  const { prepare, execute, pending } = useSwap(portfolio);

  const [routeIdx, setRouteIdx] = useState(0);
  const [inAddr, setInAddr] = useState("");
  const [outPick, setOutPick] = useState("");
  const [outCustom, setOutCustom] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(100);
  const [prepared, setPrepared] = useState<PreparedSwap>();
  const [quoting, setQuoting] = useState(false);
  const [result, setResult] = useState<ShownResult>();
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();

  const holdings = portfolio.holdings.filter((h) => h.balance > BigInt(0));
  const tokenIn = holdings.find((h) => h.address === (inAddr || holdings[0]?.address));
  const outOptions = useMemo(() => {
    const m = new Map<string, TokenInfo>();
    for (const t of tokensFor(chainId)) m.set(t.address.toLowerCase(), { address: t.address, symbol: t.symbol, decimals: t.decimals });
    for (const h of portfolio.holdings) m.set(h.address.toLowerCase(), { address: h.address, symbol: h.symbol, decimals: h.decimals });
    return [...m.values()].filter((t) => t.address.toLowerCase() !== tokenIn?.address.toLowerCase());
  }, [chainId, portfolio.holdings, tokenIn]);
  const outAddr = outPick === OTHER ? outCustom.trim() : outPick || outOptions[0]?.address || "";
  const customInfo = useTokenInfo(chainId, outPick === OTHER && isAddress(outAddr) ? outAddr : undefined);
  const tokenOut: TokenInfo | undefined =
    outPick === OTHER ? customInfo.info : outOptions.find((t) => t.address.toLowerCase() === outAddr.toLowerCase());

  const route = routes[routeIdx] ?? routes[0];
  const parsed = tokenIn ? safeParseUnits(amount, tokenIn.decimals) : undefined;
  const tooMuch = parsed !== undefined && tokenIn !== undefined && parsed > tokenIn.balance;
  const canManage = portfolio.account?.canManageAssets === true;
  const inputsOk = !!route && !!tokenIn && !!tokenOut && !!parsed && parsed > BigInt(0) && !tooMuch;

  if (routes.length === 0) {
    return (
      <div className="card" data-testid="swap-disabled">
        <h3>Swap</h3>
        <Notice kind="info">Swaps not enabled on this chain.</Notice>
      </div>
    );
  }

  const reset = () => { setPrepared(undefined); setResult(undefined); setError(undefined); setNote(undefined); };

  async function doQuote() {
    reset();
    setQuoting(true);
    try {
      setPrepared(await prepare({ route: route!, tokenIn: tokenIn!, tokenOut: tokenOut!, amountIn: parsed!, slippageBps: slippage }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setQuoting(false);
    }
  }

  async function doSwap() {
    setError(undefined);
    setResult(undefined);
    setNote(undefined);
    try {
      // Re-quote right before sending so minOut is fresh, then execute exactly what was quoted.
      const input = { route: route!, tokenIn: tokenIn!, tokenOut: tokenOut!, amountIn: parsed!, slippageBps: slippage };
      let fresh = await prepare(input);
      const excluded: string[] = [];
      for (;;) {
        setPrepared(fresh);
        try {
          // Snapshot the tokens: after the swap the holdings change, so the live selection may no longer match what was traded.
          setResult({ ...(await execute(fresh)), shownIn: tokenIn!, shownOut: tokenOut! });
          break;
        } catch (err) {
          // The pre-send simulation reverted (nothing signed). A ParaSwap route can depend on a liquidity source that does not
          // work at this chain state (typically market makers on a stale fork): re-quote without it, at most twice.
          const next = (fresh.exchanges ?? []).filter((e) => !excluded.includes(e));
          if (!(err instanceof SwapSimulationError) || route!.kind !== "paraSwapV6" || next.length === 0 || excluded.length >= 2) throw err;
          excluded.push(...next);
          setNote(`ParaSwap route via ${next.join(", ")} reverted in simulation; re-quoted without it.`);
          fresh = await prepare({ ...input, excludeDexes: excluded });
        }
      }
      setAmount("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card" data-testid="swap-card">
      <h3>Swap</h3>
      {!canManage && (
        <Notice kind="info">{isConnected ? "Only the portfolio owner or an asset manager can swap." : "Connect the owner wallet to swap."}</Notice>
      )}
      <label className="small">Route (adapter)
        <select
          value={routeIdx} onChange={(e) => { setRouteIdx(Number(e.target.value)); reset(); }} aria-label="Swap route" data-testid="swap-route"
        >
          {routes.map((r, i) => <option key={r.address} value={i}>{r.label}{i === 0 ? " (default)" : ""}</option>)}
        </select>
      </label>
      {route && <p className="muted small" data-testid="swap-route-adapter">Adapter: {route.address}</p>}
      <div className="row">
        <label className="small">Sell
          <select value={tokenIn?.address ?? ""} onChange={(e) => { setInAddr(e.target.value); setOutPick(""); reset(); }} aria-label="Asset in">
            {holdings.length === 0 && <option value="">(no tracked asset with balance)</option>}
            {holdings.map((h) => <option key={h.address} value={h.address}>{h.symbol} (bal {formatAmount(h.balance, h.decimals)})</option>)}
          </select>
        </label>
        <label className="small">Buy
          <select value={outPick || outOptions[0]?.address || ""} onChange={(e) => { setOutPick(e.target.value); reset(); }} aria-label="Asset out">
            {outOptions.map((t) => <option key={t.address} value={t.address}>{t.symbol} ({shortAddress(t.address)})</option>)}
            <option value={OTHER}>Other (paste address)…</option>
          </select>
        </label>
      </div>
      {outPick === OTHER && (
        <input value={outCustom} onChange={(e) => { setOutCustom(e.target.value); reset(); }} placeholder="Token address 0x…" spellCheck={false} aria-label="Custom asset out" />
      )}
      <input value={amount} onChange={(e) => { setAmount(e.target.value); reset(); }} placeholder={`Amount (${tokenIn?.symbol ?? ""})`} inputMode="decimal" aria-label="Swap amount" />
      {tooMuch && <span className="field-error">Exceeds the vault&apos;s balance</span>}
      <label className="small">Slippage
        <select value={slippage} onChange={(e) => { setSlippage(Number(e.target.value)); reset(); }} aria-label="Swap slippage">
          {SLIPPAGE_OPTIONS.map((b) => <option key={b} value={b}>{b / 100}%</option>)}
        </select>
      </label>
      <div className="row">
        <button className="btn btn-secondary" type="button" disabled={!inputsOk || quoting || pending} onClick={doQuote}>
          {quoting ? "Quoting…" : "Get quote"}
        </button>
        <button className="btn" type="button" disabled={disabled || !isConnected || !canManage || !inputsOk || pending || quoting} onClick={doSwap}>
          {pending ? "Swapping…" : "Swap"}
        </button>
      </div>
      {prepared && tokenIn && tokenOut && (
        <p className="muted small" data-testid="swap-quote">
          {route?.kind === "paraSwapV6" ? "ParaSwap" : "Uniswap"} quote: {formatAmount(prepared.amountIn, tokenIn.decimals)} {tokenIn.symbol} → ≈{" "}
          {formatAmount(prepared.expectedOut, tokenOut.decimals)} {tokenOut.symbol} (min {formatAmount(prepared.minOut, tokenOut.decimals)}) · {prepared.description}
        </p>
      )}
      {note && <Notice kind="info"><span data-testid="swap-reroute-note">{note}</span></Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          <div data-testid="swap-result">
            <strong>Swap executed.</strong>{" "}
            Route: <span data-testid="swap-result-route" data-route-kind={result.routeKind}>{result.routeLabel}</span> · Adapter:{" "}
            <code data-testid="swap-result-adapter">{result.adapter}</code>
            <ul>
              <li data-testid="swap-result-spent">
                Sold {result.spentAssets.map((a, i) => `${formatAmount(result.spentAmounts[i], result.shownIn.decimals)} ${a.toLowerCase() === result.shownIn.address.toLowerCase() ? result.shownIn.symbol : shortAddress(a)}`).join(", ")}
              </li>
              <li data-testid="swap-result-received">
                Received {result.incomingAssets.map((a, i) => `${formatAmount(result.incomingAmounts[i], result.shownOut.decimals)} ${a.toLowerCase() === result.shownOut.address.toLowerCase() ? result.shownOut.symbol : shortAddress(a)}`).join(", ")}
              </li>
            </ul>
            {explorerUrl(chainId, `/tx/${result.txHash}`) && <a href={explorerUrl(chainId, `/tx/${result.txHash}`)} target="_blank" rel="noreferrer">View transaction</a>}
          </div>
        </Notice>
      )}
    </div>
  );
}

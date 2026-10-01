"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { explorerUrl, isSupportedChainId } from "@/config/chains";
import { formatAmount, safeParseUnits, shortAddress } from "@/lib/format";
import { useDeposit, useRedeem, useTokenBalance, useVault } from "@/lib/contracts";
import { Notice } from "./Notice";
import { useSelectedChain } from "./useSelectedChain";

export function PortfolioView() {
  const router = useRouter();
  const params = useSearchParams();
  const { chainId, chain, setReadChainId, can, isSupported } = useSelectedChain();
  const { isConnected } = useAccount();

  const qsChain = Number(params.get("chain"));
  const qsVault = params.get("vault") ?? "";
  const [input, setInput] = useState(qsVault);

  // honour ?chain= for read-only deep links when no wallet is connected
  useEffect(() => {
    if (!isConnected && isSupportedChainId(qsChain)) setReadChainId(qsChain);
  }, [qsChain, isConnected, setReadChainId]);

  const vault = useVault(chainId, qsVault || undefined);

  return (
    <>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/portfolio?chain=${chainId}&vault=${input.trim()}`);
        }}
      >
        <input className="grow" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Vault (VaultProxy) address 0x…" spellCheck={false} />
        <button className="btn" type="submit" disabled={!isAddress(input.trim())}>Load</button>
      </form>
      <p className="muted small">Network: <strong>{chain?.name ?? "Unsupported"}</strong>. Portfolio listing by wallet needs an indexer (TODO).</p>

      {!isSupported && <Notice kind="warn">Switch to a supported network.</Notice>}
      {qsVault && !isAddress(qsVault) && <Notice kind="error">Invalid vault address.</Notice>}
      {vault.valid && vault.isLoading && <p className="muted">Loading…</p>}
      {vault.valid && !vault.isLoading && vault.isError && (
        <Notice kind="error">No vault found at this address on {chain?.name}. Check the address and network.</Notice>
      )}

      {vault.valid && !vault.isLoading && !vault.isError && (
        <div className="card">
          <h2>{vault.name ?? "Portfolio"} <span className="muted">({vault.symbol})</span></h2>
          <dl className="dl">
            <dt>Vault</dt>
            <dd>{explorerUrl(chainId, `/address/${qsVault}`) ? <a href={explorerUrl(chainId, `/address/${qsVault}`)} target="_blank" rel="noreferrer">{shortAddress(qsVault)}</a> : shortAddress(qsVault)}</dd>
            <dt>Owner</dt><dd>{vault.owner ? shortAddress(vault.owner) : "-"}</dd>
            <dt>Total shares</dt><dd>{formatAmount(vault.totalSupply, 18)}</dd>
            <dt>Your shares</dt><dd>{isConnected ? formatAmount(vault.shareBalance, 18) : "Connect wallet"}</dd>
            <dt>Denomination asset</dt><dd>{vault.denominationAsset ? shortAddress(vault.denominationAsset) : "-"}</dd>
            <dt>Tracked assets</dt>
            <dd>{vault.trackedAssets.length ? vault.trackedAssets.map((a) => shortAddress(a)).join(", ") : "None"}</dd>
          </dl>
          {/* TODO(valuation): NAV / GAV / share price (FundValueCalculatorRouter) once its address is configured per chain. */}

          <div className="grid">
            {can("deposit") ? (
              <DepositCard chainId={chainId} comptroller={vault.comptroller} asset={vault.denominationAsset} onDone={vault.refetch} />
            ) : (
              <Notice kind="info">Deposits are not enabled on {chain?.name}.</Notice>
            )}
            {can("redeem") ? (
              <RedeemCard chainId={chainId} comptroller={vault.comptroller} shares={vault.shareBalance} onDone={vault.refetch} />
            ) : (
              <Notice kind="info">Redemptions are not enabled on {chain?.name}.</Notice>
            )}
          </div>

          {can("swap") && (
            <div className="card inner">
              <h3>Swap</h3>
              <p className="muted">TODO(swap): manager-only trade UI via IntegrationManager adapters.</p>
            </div>
          )}
          {/* Swap UI is intentionally not rendered when the flag is off (e.g. Robinhood Chain phase 1). */}
        </div>
      )}
    </>
  );
}

function DepositCard(props: { chainId: number; comptroller?: `0x${string}`; asset?: `0x${string}`; onDone: () => unknown }) {
  const { isConnected } = useAccount();
  const { deposit, pending } = useDeposit(props.chainId, props.comptroller, props.asset);
  const token = useTokenBalance(props.chainId, props.asset);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string }>();
  const decimals = token.decimals ?? 18;
  const parsed = safeParseUnits(amount, decimals);

  return (
    <div className="card inner">
      <h3>Deposit</h3>
      <p className="muted small">Balance: {formatAmount(token.balance, decimals)} {token.symbol ?? ""}</p>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" />
      <button
        className="btn"
        disabled={!isConnected || !parsed || parsed === BigInt(0) || pending || !props.comptroller || token.decimals === undefined}
        onClick={async () => {
          setMsg(undefined);
          try {
            await deposit(parsed as bigint);
            setMsg({ kind: "ok", text: "Deposit confirmed." });
            setAmount("");
            await props.onDone();
          } catch (err) {
            setMsg({ kind: "error", text: err instanceof Error ? err.message.split("\n")[0] ?? "Failed" : "Failed" });
          }
        }}
      >
        {pending ? "Depositing…" : "Deposit"}
      </button>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

function RedeemCard(props: { chainId: number; comptroller?: `0x${string}`; shares?: bigint; onDone: () => unknown }) {
  const { isConnected } = useAccount();
  const { redeem, pending } = useRedeem(props.chainId, props.comptroller);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string }>();
  const parsed = safeParseUnits(amount, 18);
  const tooMuch = parsed !== undefined && props.shares !== undefined && parsed > props.shares;

  return (
    <div className="card inner">
      <h3>Redeem</h3>
      <p className="muted small">Your shares: {formatAmount(props.shares, 18)}</p>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Shares" inputMode="decimal" />
      {tooMuch && <span className="field-error">Exceeds your share balance</span>}
      <button
        className="btn"
        disabled={!isConnected || !parsed || parsed === BigInt(0) || tooMuch || pending || !props.comptroller}
        onClick={async () => {
          setMsg(undefined);
          try {
            await redeem(parsed as bigint);
            setMsg({ kind: "ok", text: "Redemption confirmed." });
            setAmount("");
            await props.onDone();
          } catch (err) {
            setMsg({ kind: "error", text: err instanceof Error ? err.message.split("\n")[0] ?? "Failed" : "Failed" });
          }
        }}
      >
        {pending ? "Redeeming…" : "Redeem in kind"}
      </button>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { explorerUrl } from "@/config/chains";
import { tokensFor } from "@/config/tokens";
import { getFundDeployer, useCreatePortfolio, type CreatePortfolioResult } from "@/lib/contracts";
import { Notice } from "./Notice";
import { useSelectedChain } from "./useSelectedChain";

export function CreatePortfolioForm() {
  const { isConnected } = useAccount();
  const { chainId, chain, isSupported, can } = useSelectedChain();
  const { create, pending } = useCreatePortfolio();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [asset, setAsset] = useState("");
  const [result, setResult] = useState<CreatePortfolioResult>();
  const [error, setError] = useState<string>();

  const tokens = tokensFor(chainId);
  const deployer = getFundDeployer(chainId);
  const assetValid = isAddress(asset);
  const nameValid = name.trim().length > 0 && symbol.trim().length > 0;
  const enabled = isSupported && can("create");
  const ready = isConnected && enabled && !!deployer && assetValid && nameValid && !pending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await create({ chainId, name: name.trim(), symbol: symbol.trim(), denominationAsset: asset as Address }));
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0] : "Transaction failed");
    }
  }

  return (
    <form onSubmit={onSubmit} className="card form">
      <p className="muted">Network: <strong>{chain?.name ?? "Unsupported"}</strong></p>
      {!isSupported && <Notice kind="warn">Switch to a supported network using the selector above.</Notice>}
      {isSupported && !enabled && <Notice kind="warn">Portfolio creation is not enabled on {chain?.name}.</Notice>}
      {isSupported && enabled && !deployer && (
        <Notice kind="warn">
          Protocol not deployed on {chain?.name} yet (FundDeployer address not configured). The form is
          functional once <code>app/src/lib/contracts/addresses.ts</code> or the env var is set.
        </Notice>
      )}

      <label>Portfolio name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Portfolio" maxLength={64} />
      </label>
      <label>Share symbol
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="MYPF" maxLength={16} />
      </label>
      <label>Denomination asset (ERC-20 address)
        <input value={asset} onChange={(e) => setAsset(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
        {asset && !assetValid && <span className="field-error">Not a valid address</span>}
      </label>
      {tokens.length > 0 && (
        <div className="row">
          <span className="muted">Quick pick:</span>
          {tokens.map((t) => (
            <button type="button" key={t.address} className="chip" onClick={() => setAsset(t.address)} title={t.note}>
              {t.symbol}
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        The denomination asset must be registered as a primitive with the protocol&apos;s ValueInterpreter,
        otherwise creation reverts. Fees and policies are not configurable yet.
      </p>

      <button className="btn" type="submit" disabled={!ready}>
        {pending ? "Creating…" : !isConnected ? "Connect wallet to continue" : "Create portfolio"}
      </button>

      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          Submitted.{" "}
          {explorerUrl(chainId, `/tx/${result.txHash}`) && (
            <a href={explorerUrl(chainId, `/tx/${result.txHash}`)} target="_blank" rel="noreferrer">View transaction</a>
          )}
          {result.vaultProxy && (
            <> {" · "}<Link href={`/portfolio?chain=${chainId}&vault=${result.vaultProxy}`}>Open portfolio</Link></>
          )}
        </Notice>
      )}
    </form>
  );
}

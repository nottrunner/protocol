"use client";

import Link from "next/link";
import { useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { explorerUrl, portfolioPath } from "@/config/chains";
import {
  errorMessage, useCreatePortfolio, useDenominationCheck, useDeployment, type CreatePortfolioResult,
} from "@/lib/contracts";
import { shortAddress } from "@/lib/format";
import { DeploymentNotices } from "./DeploymentNotices";
import { Notice } from "./Notice";
import { useSelectedChain } from "./useSelectedChain";

const OTHER = "other";

export function CreatePortfolioForm() {
  const { isConnected } = useAccount();
  const { chainId, chain, isSupported, can } = useSelectedChain();
  const { create, pending } = useCreatePortfolio();
  const deployment = useDeployment(chainId);

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [pick, setPick] = useState<string>(""); // an allowed asset address, or OTHER
  const [custom, setCustom] = useState("");
  const [result, setResult] = useState<CreatePortfolioResult>();
  const [error, setError] = useState<string>();

  // Allowed list from the deployment record / env is restrictive; the fallback list also allows a pasted address.
  const allowCustom = deployment.denominationSource === "fallback";
  const assets = deployment.denominationAssets;
  const effectivePick = pick || (assets.length === 1 ? assets[0]!.address : "");
  const asset = (effectivePick === OTHER ? custom.trim() : effectivePick) as Address | "";
  const assetValid = asset !== "" && isAddress(asset);
  const denom = useDenominationCheck(chainId, assetValid ? (asset as Address) : undefined);

  const nameValid = name.trim().length > 0 && symbol.trim().length > 0;
  const enabled = isSupported && can("create");
  const hasDeployer = !!deployment.fundDeployer;
  const denomOk = denom.status === "supported" || denom.status === "unknown";
  const ready = isConnected && enabled && hasDeployer && assetValid && denomOk && nameValid && !pending;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(undefined);
    try {
      setResult(await create({ chainId, name: name.trim(), symbol: symbol.trim(), denominationAsset: asset as Address }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit} className="card form" aria-label="Create portfolio">
      <p className="muted">Network: <strong>{chain?.name ?? "Unsupported"}</strong></p>
      {!isSupported && <Notice kind="warn">Switch to a supported network using the selector above.</Notice>}
      {isSupported && !enabled && <Notice kind="warn">Portfolio creation is not enabled on {chain?.name}.</Notice>}
      {isSupported && <DeploymentNotices chainId={chainId} />}

      <label>Portfolio name
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Portfolio" maxLength={64} />
      </label>
      <label>Share symbol
        <input name="symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="MYPF" maxLength={16} />
      </label>
      <label>Denomination asset
        <select name="denomination" value={effectivePick} onChange={(e) => setPick(e.target.value)} disabled={!hasDeployer}>
          <option value="" disabled>Select…</option>
          {assets.map((a) => (
            <option key={a.address} value={a.address}>{a.symbol} ({shortAddress(a.address)})</option>
          ))}
          {allowCustom && <option value={OTHER}>Other (paste address)…</option>}
        </select>
      </label>
      {effectivePick === OTHER && (
        <label>Denomination asset address
          <input name="customAsset" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0x…" spellCheck={false} />
          {custom && !assetValid && <span className="field-error">Not a valid address</span>}
        </label>
      )}
      {assets.length === 0 && hasDeployer && !allowCustom && <Notice kind="warn">The deployment lists no denomination asset.</Notice>}
      {assetValid && (
        <p className="muted small" data-testid="denomination-check">
          {denom.status === "loading" && "Checking the denomination asset against the ValueInterpreter…"}
          {denom.status === "supported" && `${denom.symbol ?? "Asset"} (${denom.decimals ?? "?"} decimals) is a registered primitive: OK.`}
          {denom.status === "unknown" && "Could not verify that this asset is registered with the ValueInterpreter; creation reverts if it is not."}
        </p>
      )}
      {denom.status === "unsupported" && (
        <Notice kind="error">
          This asset is not registered as a primitive with the ValueInterpreter on {chain?.name}; createNewFund would revert
          (&quot;init: Bad denomination asset&quot;).
        </Notice>
      )}
      <p className="muted small">The portfolio is created with you as owner, no fees and no policies (not configurable yet).</p>

      <button className="btn" type="submit" disabled={!ready}>
        {pending ? "Creating…" : !isConnected ? "Connect wallet to continue" : "Create portfolio"}
      </button>

      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <Notice kind="ok">
          <strong>Portfolio created.</strong>
          <dl className="dl" data-testid="create-result">
            <dt>Vault</dt><dd data-testid="result-vault">{result.vaultProxy}</dd>
            <dt>Comptroller</dt><dd data-testid="result-comptroller">{result.comptrollerProxy}</dd>
            <dt>Owner</dt><dd>{result.owner}</dd>
            <dt>Transaction</dt>
            <dd>
              {explorerUrl(chainId, `/tx/${result.txHash}`)
                ? <a href={explorerUrl(chainId, `/tx/${result.txHash}`)} target="_blank" rel="noreferrer">{shortAddress(result.txHash)}</a>
                : shortAddress(result.txHash)}
            </dd>
          </dl>
          <Link className="btn" href={portfolioPath(chainId, result.vaultProxy)}>Open portfolio</Link>
        </Notice>
      )}
    </form>
  );
}

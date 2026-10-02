"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";
import { useAccount, useConfig } from "wagmi";
import { chainIdFromParam, portfolioPath } from "@/config/chains";
import {
  loadSavedVaults, readPortfolio, removeSaved, storeSavedVaults, useDeployment, useMyPortfolios, type SavedVaults,
} from "@/lib/contracts";
import { DeploymentNotices } from "./DeploymentNotices";
import { Notice } from "./Notice";
import { useSelectedChain } from "./useSelectedChain";

/**
 * /portfolio: "My portfolios" (NewFundCreated logs by creator, no indexer) + paste-a-vault fallback. Also redirects the legacy
 * /portfolio?chain=&vault= links to /portfolio/<chain>/<vault>.
 */
export function MyPortfolios() {
  const router = useRouter();
  const params = useSearchParams();
  const config = useConfig();
  const { address, isConnected } = useAccount();
  const { chainId, chain } = useSelectedChain();
  const my = useMyPortfolios(chainId, address);
  const protocolDeployed = !!useDeployment(chainId).fundDeployer;
  const [saved, setSaved] = useState<SavedVaults>({});
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => setSaved(loadSavedVaults()), []);

  // legacy deep link
  useEffect(() => {
    const qsVault = params.get("vault");
    const qsChain = chainIdFromParam(params.get("chain") ?? undefined);
    if (qsVault && qsChain !== undefined) router.replace(portfolioPath(qsChain, qsVault));
  }, [params, router]);

  const fromLogs = my.scan?.logs ?? [];
  const savedHere = (saved[String(chainId)] ?? []).filter((a) => !fromLogs.some((l) => l.vault.toLowerCase() === a.toLowerCase()));

  async function open(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    const v = input.trim();
    if (!isAddress(v)) return setErr("Not a valid address");
    setBusy(true);
    try {
      await readPortfolio(config, { chainId, vault: v as Address }); // proves it looks like a vault on this chain before opening
      // Not saved here: the portfolio page saves a vault only after the Dispatcher has verified it.
      router.push(portfolioPath(chainId, v));
    } catch {
      setErr(`No vault found at this address on ${chain?.name}. Check the address and network.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted small">Network: <strong>{chain?.name ?? "Unsupported"}</strong></p>
      <DeploymentNotices chainId={chainId} />

      <h2>My portfolios</h2>
      {!isConnected && <p className="muted">Connect a wallet to list portfolios you created on {chain?.name}.</p>}
      {isConnected && my.isLoading && <p className="muted">Scanning NewFundCreated logs…</p>}
      {isConnected && my.isError && (
        <Notice kind="warn" >Could not read portfolio logs from the RPC ({(my.error as Error)?.message?.split("\n")[0]}). Paste a vault address below.</Notice>
      )}
      {my.scan && !my.scan.complete && (
        <Notice kind="warn">
          The RPC refused part of the log range{my.scan.error ? ` (${my.scan.error})` : ""}; scanned back to block {my.scan.scannedFrom.toString()}. Older portfolios may be
          missing: paste a vault address below.
        </Notice>
      )}
      {my.scan?.bounded && my.scan.complete && (
        <Notice kind="info">No deploy block in the deployment record: scanned a bounded look-back only (from block {my.scan.from.toString()}).</Notice>
      )}
      <ul className="list" data-testid="my-portfolios">
        {fromLogs.map((l) => (
          <li key={l.vault} data-testid="my-portfolio-item">
            <Link href={portfolioPath(chainId, l.vault)}>{l.vault}</Link> <span className="muted small">created in block {l.blockNumber.toString()}</span>
          </li>
        ))}
        {savedHere.map((a) => (
          <li key={a} data-testid="my-portfolio-item">
            <Link href={portfolioPath(chainId, a)}>{a}</Link> <span className="muted small">saved</span>{" "}
            <button className="chip" type="button" onClick={() => { const n = removeSaved(loadSavedVaults(), chainId, a); storeSavedVaults(n); setSaved(n); }}>remove</button>
          </li>
        ))}
        {isConnected && !my.isLoading && fromLogs.length === 0 && savedHere.length === 0 && <li className="muted">No portfolios found for this account on {chain?.name}.</li>}
      </ul>

      <h2>Open a portfolio by vault address</h2>
      {!protocolDeployed && (
        <Notice kind="warn"><span data-testid="paste-disabled">Protocol not deployed on {chain?.name}: vaults cannot be verified, so opening a vault by address is disabled.</span></Notice>
      )}
      <form className="row" onSubmit={open}>
        <input className="grow" name="vaultAddress" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Vault (VaultProxy) address 0x…" spellCheck={false} aria-label="Vault address" disabled={!protocolDeployed} />
        <button className="btn" type="submit" disabled={!protocolDeployed || !isAddress(input.trim()) || busy}>{busy ? "Checking…" : "Open"}</button>
      </form>
      {err && <Notice kind="error">{err}</Notice>}
      <p className="muted small">
        Listing finds portfolios you <em>created</em> (the event&apos;s indexed creator). Portfolios created by someone else for you, or
        beyond the RPC&apos;s log range, can be opened by pasting the vault address; vaults you open are remembered in this browser once the Dispatcher has verified them. The page only enables deposit / redeem / swap for verified vaults.
      </p>
    </>
  );
}

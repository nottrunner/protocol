"use client";

import { useDeployment, useDeploymentHealth } from "@/lib/contracts";
import { getChain } from "@/config/chains";
import { Notice } from "./Notice";

/** Shared per-chain deployment status: "Protocol not deployed", fork record in use, FundDeployer missing on the RPC. */
export function DeploymentNotices({ chainId }: { chainId: number }) {
  const deployment = useDeployment(chainId);
  const health = useDeploymentHealth(chainId);
  const name = getChain(chainId)?.name ?? `chain ${chainId}`;

  if (!deployment.fundDeployer) {
    return (
      <Notice kind="warn">
        Protocol not deployed on {name}. No deployment record is bundled for this chain and no{" "}
        <code>NEXT_PUBLIC_FUND_DEPLOYER_*</code> override is set.
        {deployment.notes.length > 0 && <> ({deployment.notes[0]})</>}
      </Notice>
    );
  }
  return (
    <>
      {deployment.isFork && (
        <Notice kind="warn">
          {name} addresses come from a <strong>fork</strong> deployment record: they exist only on a local Anvil fork.
        </Notice>
      )}
      {health === "no-code" && (
        <Notice kind="error">
          No contract at the configured FundDeployer on {name}. The chain&apos;s RPC (<code>NEXT_PUBLIC_RPC_URL_*</code>) is
          probably not the fork/node this deployment lives on.
        </Notice>
      )}
      {health === "not-live" && <Notice kind="error">The FundDeployer on {name} is not live yet (release not set live).</Notice>}
      {health === "unreachable" && <Notice kind="error">Could not reach the {name} RPC to verify the FundDeployer.</Notice>}
    </>
  );
}

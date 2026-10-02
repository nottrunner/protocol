import type { Address } from "viem";
import { getDeployment, type ChainDeployment } from "@/lib/deployments";

export type ProtocolAddresses = {
  /** FundDeployer of the live release. Needed for Create Portfolio. */
  fundDeployer: Address | null;
  // Per-vault ComptrollerProxy / VaultProxy are discovered on-chain (vault.getAccessor()), not configured.
};

/**
 * Per-chain deployed addresses now come from the typed deployment loader (`src/lib/deployments`): the repo's
 * `deployments/<chain>.json` records (mainnet-labelled ones only unless NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1), with
 * NEXT_PUBLIC_FUND_DEPLOYER_<CHAIN> (and friends) taking precedence. No address is hardcoded in the app.
 */
export function getProtocolAddresses(chainId: number): ProtocolAddresses {
  return { fundDeployer: getDeployment(chainId).fundDeployer };
}

export function getFundDeployer(chainId: number): Address | null {
  return getDeployment(chainId).fundDeployer;
}

export function getChainDeployment(chainId: number): ChainDeployment {
  return getDeployment(chainId);
}

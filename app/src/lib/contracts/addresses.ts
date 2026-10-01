import type { Address } from "viem";
import type { SupportedChainId } from "@/config/chains";

export type ProtocolAddresses = {
  /** FundDeployer of the live release. Needed for Create Portfolio. */
  fundDeployer: Address | null;
  // Per-vault ComptrollerProxy / VaultProxy are discovered on-chain (vault.getAccessor()), not configured.
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function fromEnv(value: string | undefined): Address | null {
  return value && ADDRESS_RE.test(value) ? (value as Address) : null;
}

/**
 * Per-chain deployed addresses. Single place to edit once deployments exist.
 *
 * Values are `null` on purpose: NO address has been verified for this app yet, and none are invented.
 * A NEXT_PUBLIC_FUND_DEPLOYER_<CHAIN> env var (see .env.example) overrides the file value so preview
 * deployments can point at a test deployment without a code change. `null` => the UI shows
 * "not deployed" and disables the corresponding write actions.
 *
 * TODO(addresses): Ethereum (1): Enzyme Blue v4 FundDeployer is listed in enzymefinance/docs
 *   general-info/codebase/contracts/mainnet.md; verify it on-chain and decide reuse vs. fresh fork deployment.
 * TODO(addresses): Base (8453): same, base.md.
 * TODO(addresses): Arbitrum One (42161): same, arbitrum.md.
 * TODO(addresses): Robinhood Chain (4663): no Enzyme deployment exists; fill after we deploy the fork.
 */
export const protocolAddresses: Record<SupportedChainId, ProtocolAddresses> = {
  1: { fundDeployer: fromEnv(process.env.NEXT_PUBLIC_FUND_DEPLOYER_ETHEREUM) /* TODO(addresses) */ },
  8453: { fundDeployer: fromEnv(process.env.NEXT_PUBLIC_FUND_DEPLOYER_BASE) /* TODO(addresses) */ },
  42161: { fundDeployer: fromEnv(process.env.NEXT_PUBLIC_FUND_DEPLOYER_ARBITRUM) /* TODO(addresses) */ },
  4663: { fundDeployer: fromEnv(process.env.NEXT_PUBLIC_FUND_DEPLOYER_ROBINHOOD) /* TODO(addresses) */ },
};

export function getProtocolAddresses(chainId: number): ProtocolAddresses {
  return (protocolAddresses as Record<number, ProtocolAddresses | undefined>)[chainId] ?? { fundDeployer: null };
}

export function getFundDeployer(chainId: number): Address | null {
  return getProtocolAddresses(chainId).fundDeployer;
}

import { isAddress, zeroAddress, type Address } from "viem";
import type { Config } from "wagmi";
import { readContract } from "wagmi/actions";
import { comptrollerAbi, dispatcherAbi, fundDeployerAbi, vaultAbi } from "./abis";
import { getChainDeployment } from "./addresses";

/**
 * Vault verification. The app reads a vault's comptroller FROM the vault itself, and deposit approves the denomination token to
 * that comptroller, so an arbitrary pasted / deep-linked contract could otherwise get a user to approve a token to an attacker.
 * A vault is trusted only if the chain's Dispatcher says it was created by the FundDeployer this app is configured with.
 *
 * FAILS CLOSED: anything other than "the Dispatcher returned exactly the configured FundDeployer" is `unverified`: no configured
 * FundDeployer, no resolvable Dispatcher, a reverting / failing / timing-out call, the zero address, or a different FundDeployer.
 */

export type UnverifiedReason =
  | "no-fund-deployer" // nothing configured for the chain ("Protocol not deployed")
  | "no-dispatcher" // FundDeployer configured but the Dispatcher cannot be resolved
  | "invalid-vault" // not an address
  | "dispatcher-error" // revert, RPC failure, timeout, undecodable return value
  | "zero-address" // Dispatcher does not know this vault
  | "mismatch" // created by a different FundDeployer
  | "comptroller-mismatch"; // vault.getAccessor() and comptroller.getVaultProxy() do not point at each other

export type VaultVerification = { status: "verified"; fundDeployer: Address } | { status: "unverified"; reason: UnverifiedReason; detail?: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const UNVERIFIED_MESSAGES: Record<UnverifiedReason, string> = {
  "no-fund-deployer": "The protocol is not deployed on this network (no FundDeployer configured), so vaults cannot be verified.",
  "no-dispatcher": "The Dispatcher for this network is unknown, so vaults cannot be verified.",
  "invalid-vault": "This is not a valid vault address.",
  "dispatcher-error": "The Dispatcher could not confirm this vault (the call failed or reverted).",
  "zero-address": "The Dispatcher does not know this address: it is not a vault created by this protocol.",
  mismatch: "This vault was created by a different FundDeployer than the one this app is configured for.",
  "comptroller-mismatch": "This vault and its comptroller do not point at each other.",
};

/** Pure decision: what a Dispatcher answer means. Every branch except an exact match is `unverified`. */
export function evaluateVaultVerification(input: {
  configuredFundDeployer?: string | null;
  dispatcher?: string | null;
  vaultValid?: boolean;
  reportedFundDeployer?: unknown;
  error?: unknown;
}): VaultVerification {
  const unverified = (reason: UnverifiedReason, detail?: string): VaultVerification => ({ status: "unverified", reason, detail });
  if (input.vaultValid === false) return unverified("invalid-vault");
  if (!input.configuredFundDeployer || !isAddress(input.configuredFundDeployer) || input.configuredFundDeployer === zeroAddress) return unverified("no-fund-deployer");
  if (!input.dispatcher || !isAddress(input.dispatcher) || input.dispatcher === zeroAddress) return unverified("no-dispatcher");
  if (input.error !== undefined) return unverified("dispatcher-error", input.error instanceof Error ? input.error.message.split("\n")[0] : String(input.error));
  const r = input.reportedFundDeployer;
  if (typeof r !== "string" || !isAddress(r)) return unverified("dispatcher-error", "unexpected Dispatcher response");
  if (r === zeroAddress) return unverified("zero-address");
  if (!same(r, input.configuredFundDeployer)) return unverified("mismatch", `Dispatcher reports ${r}`);
  return { status: "verified", fundDeployer: input.configuredFundDeployer as Address };
}

/**
 * Dispatcher for the chain: the deployment record's, else the one the configured (trusted) FundDeployer reports. Returns
 * undefined (=> unverified) if neither resolves; never throws.
 */
export async function resolveDispatcher(config: Config, chainId: number): Promise<Address | undefined> {
  const d = getChainDeployment(chainId);
  if (d.addresses.dispatcher) return d.addresses.dispatcher;
  if (!d.fundDeployer) return undefined;
  try {
    const a = await readContract(config, { chainId, address: d.fundDeployer, abi: fundDeployerAbi, functionName: "getDispatcher" });
    return a && a !== zeroAddress ? a : undefined;
  } catch {
    return undefined;
  }
}

/** Never throws: any failure is `unverified`. With `comptroller`, also checks vault <-> comptroller point at each other. */
export async function verifyVault(config: Config, args: { chainId: number; vault: string; comptroller?: Address }): Promise<VaultVerification> {
  const { chainId, vault, comptroller } = args;
  const configuredFundDeployer = getChainDeployment(chainId).fundDeployer;
  if (!isAddress(vault)) return evaluateVaultVerification({ configuredFundDeployer, vaultValid: false });
  try {
    if (!configuredFundDeployer) return evaluateVaultVerification({ configuredFundDeployer });
    const dispatcher = await resolveDispatcher(config, chainId);
    if (!dispatcher) return evaluateVaultVerification({ configuredFundDeployer, dispatcher });
    let reported: unknown;
    let error: unknown;
    try {
      reported = await readContract(config, { chainId, address: dispatcher, abi: dispatcherAbi, functionName: "getFundDeployerForVaultProxy", args: [vault] });
    } catch (e) {
      error = e ?? new Error("Dispatcher call failed");
    }
    const v = evaluateVaultVerification({ configuredFundDeployer, dispatcher, reportedFundDeployer: reported, error });
    if (v.status !== "verified" || !comptroller) return v;
    const [accessor, vaultOfComptroller] = await Promise.all([
      readContract(config, { chainId, address: vault, abi: vaultAbi, functionName: "getAccessor" }),
      readContract(config, { chainId, address: comptroller, abi: comptrollerAbi, functionName: "getVaultProxy" }),
    ]);
    if (!same(accessor, comptroller) || !same(vaultOfComptroller, vault)) return { status: "unverified", reason: "comptroller-mismatch" };
    return v;
  } catch (e) {
    return { status: "unverified", reason: "dispatcher-error", detail: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

export class UnverifiedVaultError extends Error {
  readonly reason: UnverifiedReason;
  constructor(reason: UnverifiedReason, detail?: string) {
    super(`Refusing to send a transaction for an unverified vault: ${UNVERIFIED_MESSAGES[reason]}${detail ? ` (${detail})` : ""}`);
    this.name = "UnverifiedVaultError";
    this.reason = reason;
  }
}

/** Hard guard at the top of every flow that can approve or send a vault transaction: re-verifies at send time, throws if not verified. */
export async function assertVerifiedVault(config: Config, args: { chainId: number; vault: Address; comptroller: Address }): Promise<void> {
  const v = await verifyVault(config, args);
  if (v.status !== "verified") throw new UnverifiedVaultError(v.reason, v.detail);
}

/**
 * Label for a vault listed under "My portfolios" that was saved by an earlier app version (before verification existed).
 * Fails closed: only a definite `verified` result is shown as verified; a pending check is "checking"; everything else
 * (mismatch, revert, RPC error, zero address, no FundDeployer) is shown as unverified. The vault page gates actions regardless.
 */
export function savedVaultStatus(v: VaultVerification | undefined, failed = false): "checking" | "verified" | "unverified" {
  if (failed) return "unverified";
  if (!v) return "checking";
  return v.status === "verified" ? "verified" : "unverified";
}

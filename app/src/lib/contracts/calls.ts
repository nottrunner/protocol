import { encodeFunctionData, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { fundDeployerAbi } from "./abis";

/** Pure builders / helpers for contract calls. No React, no wagmi: unit-tested against Anvil and against ABI round trips. */




// ---- create ---------------------------------------------------------------------------------------------------------

export type CreateFundParams = {
  owner: Address;
  name: string;
  symbol: string;
  denominationAsset: Address;
  /** seconds between two shares actions by the same account; 0 = none */
  sharesActionTimelock?: bigint;
  /** abi-encoded FeeManager config; "0x" = no fees (the only mode the UI exposes) */
  feeManagerConfigData?: Hex;
  /** abi-encoded PolicyManager config; "0x" = no policies */
  policyManagerConfigData?: Hex;
};

export function createNewFundArgs(p: CreateFundParams) {
  return [
    p.owner, p.name, p.symbol, p.denominationAsset, p.sharesActionTimelock ?? BigInt(0),
    p.feeManagerConfigData ?? "0x", p.policyManagerConfigData ?? "0x",
  ] as const;
}

export function encodeCreateNewFund(p: CreateFundParams): Hex {
  return encodeFunctionData({ abi: fundDeployerAbi, functionName: "createNewFund", args: createNewFundArgs(p) });
}

/** Extracts the vault + comptroller from the NewFundCreated event in a createNewFund receipt. */
export function parseNewFund(logs: readonly Log[], fundDeployer?: Address): { creator: Address; vaultProxy: Address; comptrollerProxy: Address } | undefined {
  const parsed = parseEventLogs({ abi: fundDeployerAbi, eventName: "NewFundCreated", logs: logs as Log[] });
  const evt = parsed.find((l) => !fundDeployer || l.address.toLowerCase() === fundDeployer.toLowerCase());
  return evt ? { creator: evt.args.creator, vaultProxy: evt.args.vaultProxy, comptrollerProxy: evt.args.comptrollerProxy } : undefined;
}

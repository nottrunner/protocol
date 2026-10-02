import { encodeFunctionData, parseEventLogs, type Address, type Hex, type Log } from "viem";
import { comptrollerAbi, fundDeployerAbi } from "./abis";

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

export const SHARES_UNIT = BigInt(10) ** BigInt(18);
export const BPS = BigInt(10_000);

// ---- deposit --------------------------------------------------------------------------------------------------------

/**
 * Shares expected for `amount` of the denomination asset at the current gross share price.
 * Mirrors ComptrollerLib.__buyShares: `shares = amount * 1e18 / sharePrice`, where sharePrice is the denomination-asset value
 * of 1e18 shares (for an empty vault it is exactly one denomination unit, `10 ** decimals`).
 */
export function expectedShares(amount: bigint, sharePrice: bigint): bigint {
  if (sharePrice <= BigInt(0)) return BigInt(0);
  return (amount * SHARES_UNIT) / sharePrice;
}

/**
 * `_minSharesQuantity` for buyShares. The contract REQUIRES it to be > 0 (`__buyShares: _minSharesQuantity must be >0`), so a
 * floor of 1 is enforced; `slippageBps` is the tolerated shortfall vs `expected` (covers price moves and entrance fees).
 */
export function minSharesWithSlippage(expected: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) throw new Error("slippage must be 0-10000 bps");
  const min = (expected * (BPS - BigInt(slippageBps))) / BPS;
  return min > BigInt(0) ? min : BigInt(1);
}

export function encodeBuyShares(amount: bigint, minShares: bigint): Hex {
  return encodeFunctionData({ abi: comptrollerAbi, functionName: "buyShares", args: [amount, minShares] });
}

// ---- redeem ---------------------------------------------------------------------------------------------------------

export type Redemption = { recipient: Address; shares: bigint; mode: "inKind" } | { recipient: Address; shares: bigint; mode: "specific"; assets: readonly Address[]; percentagesBps: readonly number[] };

/** Percentages for redeemSharesForSpecificAssets are in basis points of the owed value and must be positive; 10_000 = 100%. */
export function encodeRedeem(r: Redemption): Hex {
  if (r.mode === "inKind") {
    return encodeFunctionData({ abi: comptrollerAbi, functionName: "redeemSharesInKind", args: [r.recipient, r.shares, [], []] });
  }
  if (r.assets.length !== r.percentagesBps.length) throw new Error("assets and percentages must have equal length");
  return encodeFunctionData({
    abi: comptrollerAbi, functionName: "redeemSharesForSpecificAssets",
    args: [r.recipient, r.shares, r.assets, r.percentagesBps.map((p) => BigInt(p))],
  });
}

/** Payout (asset, amount) pairs from a SharesRedeemed event in a redeem receipt. */
export function parseRedeemed(logs: readonly Log[], comptroller: Address): { assets: readonly Address[]; amounts: readonly bigint[]; shares: bigint; recipient: Address } | undefined {
  const parsed = parseEventLogs({ abi: comptrollerAbi, eventName: "SharesRedeemed", logs: logs as Log[] });
  const evt = parsed.find((l) => l.address.toLowerCase() === comptroller.toLowerCase());
  return evt
    ? { assets: evt.args.receivedAssets, amounts: evt.args.receivedAssetAmounts, shares: evt.args.sharesAmount, recipient: evt.args.recipient }
    : undefined;
}

/** SharesBought from a buyShares receipt. */
export function parseBought(logs: readonly Log[], comptroller: Address): { buyer: Address; investment: bigint; sharesIssued: bigint; sharesReceived: bigint } | undefined {
  const parsed = parseEventLogs({ abi: comptrollerAbi, eventName: "SharesBought", logs: logs as Log[] });
  const evt = parsed.find((l) => l.address.toLowerCase() === comptroller.toLowerCase());
  return evt
    ? { buyer: evt.args.buyer, investment: evt.args.investmentAmount, sharesIssued: evt.args.sharesIssued, sharesReceived: evt.args.sharesReceived }
    : undefined;
}

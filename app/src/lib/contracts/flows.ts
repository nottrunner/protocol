import type { Config } from "wagmi";
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address, Hash } from "viem";
import { fundDeployerAbi } from "./abis";
import { comptrollerAbi, erc20Abi } from "./abis";
import {
  createNewFundArgs, expectedShares, minSharesWithSlippage, parseBought, parseNewFund, parseRedeemed, type CreateFundParams, type Redemption,
} from "./calls";

/**
 * Wallet flows as plain async functions over a wagmi `Config` (no React), so the exact same code runs in the UI hooks and in
 * the Anvil-backed tests. Each flow: simulate (eth_call, for readable revert reasons) -> send -> wait for the receipt ->
 * require status success -> decode events.
 */

export class FlowError extends Error {}

async function mined(config: Config, chainId: number, hash: Hash, what: string) {
  const receipt = await waitForTransactionReceipt(config, { chainId, hash });
  if (receipt.status !== "success") throw new FlowError(`${what} transaction reverted (${hash})`);
  return receipt;
}

export type CreateFlowResult = { txHash: Hash; vaultProxy: Address; comptrollerProxy: Address; owner: Address };

export async function createPortfolioFlow(
  config: Config,
  args: { chainId: number; account: Address; fundDeployer: Address } & Omit<CreateFundParams, "owner">,
): Promise<CreateFlowResult> {
  const { chainId, account, fundDeployer, ...rest } = args;
  const fundArgs = createNewFundArgs({ ...rest, owner: account });
  await simulateContract(config, { chainId, account, address: fundDeployer, abi: fundDeployerAbi, functionName: "createNewFund", args: fundArgs });
  const txHash = await writeContract(config, { chainId, account, address: fundDeployer, abi: fundDeployerAbi, functionName: "createNewFund", args: fundArgs });
  const receipt = await mined(config, chainId, txHash, "createNewFund");
  const evt = parseNewFund(receipt.logs, fundDeployer);
  if (!evt) throw new FlowError("Transaction succeeded but no NewFundCreated event was found");
  return { txHash, vaultProxy: evt.vaultProxy, comptrollerProxy: evt.comptrollerProxy, owner: account };
}


// ---- deposit ----------------------------------------------------------------------------------------------------------

export type DepositQuote = { sharePrice: bigint; expectedShares: bigint; minShares: bigint };

/**
 * Quote for buyShares. `calcGrossShareValue()` is non-view (price feeds), so it is an eth_call. For an empty vault the
 * contract returns one denomination unit (`10 ** decimals`), so the first deposit mints `amount * 1e18 / 10**decimals` shares.
 */
export async function quoteDeposit(
  config: Config,
  args: { chainId: number; comptroller: Address; amount: bigint; slippageBps: number },
): Promise<DepositQuote> {
  const { result } = await simulateContract(config, {
    chainId: args.chainId, address: args.comptroller, abi: comptrollerAbi, functionName: "calcGrossShareValue",
  });
  const exp = expectedShares(args.amount, result);
  return { sharePrice: result, expectedShares: exp, minShares: minSharesWithSlippage(exp, args.slippageBps) };
}

export type DepositFlowResult = { approveTx?: Hash; buyTx: Hash; sharesReceived: bigint; minShares: bigint; expectedShares: bigint };

/** approve (only if the allowance is short) -> quote -> buyShares(amount, minShares) -> decode SharesBought. */
export async function depositFlow(
  config: Config,
  args: { chainId: number; account: Address; comptroller: Address; denominationAsset: Address; amount: bigint; slippageBps: number },
): Promise<DepositFlowResult> {
  const { chainId, account, comptroller, denominationAsset, amount, slippageBps } = args;
  if (amount <= BigInt(0)) throw new FlowError("Enter an amount greater than zero");
  const allowance = await readContract(config, { chainId, address: denominationAsset, abi: erc20Abi, functionName: "allowance", args: [account, comptroller] });
  let approveTx: Hash | undefined;
  if (allowance < amount) {
    approveTx = await writeContract(config, { chainId, account, address: denominationAsset, abi: erc20Abi, functionName: "approve", args: [comptroller, amount] });
    await mined(config, chainId, approveTx, "approve");
  }
  // Quote AFTER the approval so the min is as fresh as possible. _minSharesQuantity must be > 0 on-chain.
  const quote = await quoteDeposit(config, { chainId, comptroller, amount, slippageBps });
  await simulateContract(config, { chainId, account, address: comptroller, abi: comptrollerAbi, functionName: "buyShares", args: [amount, quote.minShares] });
  const buyTx = await writeContract(config, { chainId, account, address: comptroller, abi: comptrollerAbi, functionName: "buyShares", args: [amount, quote.minShares] });
  const receipt = await mined(config, chainId, buyTx, "buyShares");
  const bought = parseBought(receipt.logs, comptroller);
  if (!bought) throw new FlowError("Transaction succeeded but no SharesBought event was found");
  return { approveTx, buyTx, sharesReceived: bought.sharesReceived, minShares: quote.minShares, expectedShares: quote.expectedShares };
}

// ---- redeem -----------------------------------------------------------------------------------------------------------

export type RedeemFlowResult = { txHash: Hash; sharesRedeemed: bigint; assets: readonly Address[]; amounts: readonly bigint[] };

export async function redeemFlow(
  config: Config,
  args: { chainId: number; account: Address; comptroller: Address; redemption: Redemption },
): Promise<RedeemFlowResult> {
  const { chainId, account, comptroller, redemption } = args;
  if (redemption.shares <= BigInt(0)) throw new FlowError("Enter a share amount greater than zero");
  const base = { chainId, account, address: comptroller, abi: comptrollerAbi } as const;
  let txHash: Hash;
  if (redemption.mode === "inKind") {
    const a = [redemption.recipient, redemption.shares, [], []] as const;
    await simulateContract(config, { ...base, functionName: "redeemSharesInKind", args: a });
    txHash = await writeContract(config, { ...base, functionName: "redeemSharesInKind", args: a });
  } else {
    const a = [redemption.recipient, redemption.shares, redemption.assets, redemption.percentagesBps.map((p) => BigInt(p))] as const;
    await simulateContract(config, { ...base, functionName: "redeemSharesForSpecificAssets", args: a });
    txHash = await writeContract(config, { ...base, functionName: "redeemSharesForSpecificAssets", args: a });
  }
  const receipt = await mined(config, chainId, txHash, "redeem");
  const out = parseRedeemed(receipt.logs, comptroller);
  if (!out) throw new FlowError("Transaction succeeded but no SharesRedeemed event was found");
  return { txHash, sharesRedeemed: out.shares, assets: out.assets, amounts: out.amounts };
}

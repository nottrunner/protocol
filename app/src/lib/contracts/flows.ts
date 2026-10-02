import type { Config } from "wagmi";
import { simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { Address, Hash } from "viem";
import { fundDeployerAbi } from "./abis";
import { createNewFundArgs, parseNewFund, type CreateFundParams } from "./calls";

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


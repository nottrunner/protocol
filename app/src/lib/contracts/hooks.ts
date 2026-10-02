"use client";

import { useCallback, useState } from "react";
import { isAddress, parseEventLogs, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { isFeatureEnabled } from "@/config/features";
import { comptrollerAbi, erc20Abi, fundDeployerAbi, vaultAbi } from "./abis";
import { supportedChainIds } from "@/config/chains";
import { getChainDeployment, getFundDeployer } from "./addresses";

/** Public API of the contracts layer. UI code must only use what `@/lib/contracts` re-exports. */

export type CreatePortfolioInput = {
  chainId: number;
  name: string;
  symbol: string;
  denominationAsset: Address;
  /** seconds; 0 = no shares action timelock */
  sharesActionTimelock?: bigint;
};

export type CreatePortfolioResult = { txHash: Hash; vaultProxy?: Address; comptrollerProxy?: Address };

export function useCreatePortfolio() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const publicClient = usePublicClient();

  const create = useCallback(
    async (input: CreatePortfolioInput): Promise<CreatePortfolioResult> => {
      if (!address) throw new Error("Connect a wallet first");
      if (!isFeatureEnabled(input.chainId, "create")) throw new Error("Portfolio creation is disabled on this chain");
      const fundDeployer = getFundDeployer(input.chainId);
      if (!fundDeployer) throw new Error("FundDeployer address not configured for this chain yet");
      setPending(true);
      try {
        const txHash = await writeContractAsync({
          chainId: input.chainId,
          address: fundDeployer,
          abi: fundDeployerAbi,
          functionName: "createNewFund",
          args: [
            address,
            input.name,
            input.symbol,
            input.denominationAsset,
            input.sharesActionTimelock ?? BigInt(0),
            "0x", // TODO(fees): fee config encoding (FeeManager) once fee UX is designed
            "0x", // TODO(policies): policy config encoding (PolicyManager) once policy UX is designed
          ],
        });
        const receipt = await publicClient?.waitForTransactionReceipt({ hash: txHash });
        const logs = receipt ? parseEventLogs({ abi: fundDeployerAbi, eventName: "NewFundCreated", logs: receipt.logs }) : [];
        const evt = logs[0]?.args;
        return { txHash, vaultProxy: evt?.vaultProxy, comptrollerProxy: evt?.comptrollerProxy };
      } finally {
        setPending(false);
      }
    },
    [address, publicClient, writeContractAsync],
  );

  return { create, pending };
}

export function useVault(chainId: number, vault: string | undefined) {
  const { address: account } = useAccount();
  const valid = !!vault && isAddress(vault);
  const vaultAddress = valid ? (vault as Address) : undefined;

  const vaultReads = useReadContracts({
    allowFailure: true,
    query: { enabled: valid },
    contracts: [
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "name" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "symbol" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "totalSupply" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "getOwner" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "getAccessor" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "getTrackedAssets" },
      { chainId, address: vaultAddress, abi: vaultAbi, functionName: "balanceOf", args: [account ?? "0x0000000000000000000000000000000000000000"] },
    ],
  });

  const [name, symbol, totalSupply, owner, accessor, trackedAssets, shareBalance] = vaultReads.data ?? [];
  const comptroller = accessor?.status === "success" ? (accessor.result as Address) : undefined;

  const denomination = useReadContract({
    chainId,
    address: comptroller,
    abi: comptrollerAbi,
    functionName: "getDenominationAsset",
    query: { enabled: !!comptroller },
  });

  return {
    isLoading: vaultReads.isLoading,
    isError: valid ? vaultReads.isError || (vaultReads.data !== undefined && name?.status === "failure") : true,
    valid,
    name: name?.status === "success" ? (name.result as string) : undefined,
    symbol: symbol?.status === "success" ? (symbol.result as string) : undefined,
    totalSupply: totalSupply?.status === "success" ? (totalSupply.result as bigint) : undefined,
    owner: owner?.status === "success" ? (owner.result as Address) : undefined,
    comptroller,
    trackedAssets: trackedAssets?.status === "success" ? (trackedAssets.result as readonly Address[]) : [],
    shareBalance: account && shareBalance?.status === "success" ? (shareBalance.result as bigint) : undefined,
    denominationAsset: denomination.data as Address | undefined,
    refetch: vaultReads.refetch,
  };
}

export function useDeposit(chainId: number, comptroller: Address | undefined, denominationAsset: Address | undefined) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId });
  const [pending, setPending] = useState(false);

  const deposit = useCallback(
    async (amount: bigint, minShares: bigint = BigInt(0)): Promise<Hash> => {
      if (!address || !comptroller || !denominationAsset) throw new Error("Wallet or vault not ready");
      if (!isFeatureEnabled(chainId, "deposit")) throw new Error("Deposits are disabled on this chain");
      setPending(true);
      try {
        const allowance = await publicClient?.readContract({
          address: denominationAsset, abi: erc20Abi, functionName: "allowance", args: [address, comptroller],
        });
        if ((allowance ?? BigInt(0)) < amount) {
          const approveHash = await writeContractAsync({
            chainId, address: denominationAsset, abi: erc20Abi, functionName: "approve", args: [comptroller, amount],
          });
          await publicClient?.waitForTransactionReceipt({ hash: approveHash });
        }
        // TODO(slippage): compute minShares from a share price quote instead of defaulting to 0.
        const hash = await writeContractAsync({
          chainId, address: comptroller, abi: comptrollerAbi, functionName: "buyShares", args: [amount, minShares],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return hash;
      } finally {
        setPending(false);
      }
    },
    [address, chainId, comptroller, denominationAsset, publicClient, writeContractAsync],
  );
  return { deposit, pending };
}

export function useRedeem(chainId: number, comptroller: Address | undefined) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId });
  const [pending, setPending] = useState(false);

  const redeem = useCallback(
    async (shares: bigint): Promise<Hash> => {
      if (!address || !comptroller) throw new Error("Wallet or vault not ready");
      if (!isFeatureEnabled(chainId, "redeem")) throw new Error("Redemptions are disabled on this chain");
      setPending(true);
      try {
        // In-kind redemption of all tracked assets pro rata. TODO(redeem): specific-asset redemption option.
        const hash = await writeContractAsync({
          chainId, address: comptroller, abi: comptrollerAbi, functionName: "redeemSharesInKind", args: [address, shares, [], []],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
        return hash;
      } finally {
        setPending(false);
      }
    },
    [address, chainId, comptroller, publicClient, writeContractAsync],
  );
  return { redeem, pending };
}

export function useTokenBalance(chainId: number, token: Address | undefined) {
  const { address } = useAccount();
  const res = useReadContracts({
    allowFailure: true,
    query: { enabled: !!token && !!address },
    contracts: [
      { chainId, address: token, abi: erc20Abi, functionName: "symbol" },
      { chainId, address: token, abi: erc20Abi, functionName: "decimals" },
      { chainId, address: token, abi: erc20Abi, functionName: "balanceOf", args: [address ?? "0x0000000000000000000000000000000000000000"] },
    ],
  });
  const [symbol, decimals, balance] = res.data ?? [];
  return {
    symbol: symbol?.status === "success" ? (symbol.result as string) : undefined,
    decimals: decimals?.status === "success" ? Number(decimals.result) : undefined,
    balance: balance?.status === "success" ? (balance.result as bigint) : undefined,
  };
}

/**
 * TODO(indexer): list portfolios owned by / invested in by an address. Enzyme has no on-chain enumeration;
 * this needs NewFundCreated logs (getLogs from the FundDeployer deployment block) or a subgraph.
 * Returns [] until implemented.
 */
export async function listPortfolios(chainId: number, account: Address): Promise<Address[]> {
  void chainId;
  void account;
  return [];
}

/** Resolved deployment (record + env overrides) for a chain. Static for the lifetime of the build. */
export function useDeployment(chainId: number) {
  return getChainDeployment(chainId);
}

/** True if any supported chain's addresses come from a fork / unlabelled record (QA builds only). */
export function anyForkDeployment(): boolean {
  return supportedChainIds.some((id) => getChainDeployment(id).isFork);
}

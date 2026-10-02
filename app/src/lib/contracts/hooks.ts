"use client";

import { useCallback, useState } from "react";
import { isAddress, type Address, type Hash } from "viem";
import { useAccount, useBytecode, useConfig, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { isFeatureEnabled } from "@/config/features";
import { comptrollerAbi, erc20Abi, fundDeployerAbi, valueInterpreterAbi, vaultAbi } from "./abis";
import { getChain, supportedChainIds } from "@/config/chains";
import { getChainDeployment, getFundDeployer } from "./addresses";
import { createPortfolioFlow } from "./flows";

/** Public API of the contracts layer. UI code must only use what `@/lib/contracts` re-exports. */

export type CreatePortfolioInput = {
  chainId: number;
  name: string;
  symbol: string;
  denominationAsset: Address;
  /** seconds; 0 = no shares action timelock */
  sharesActionTimelock?: bigint;
};

export type CreatePortfolioResult = { txHash: Hash; vaultProxy: Address; comptrollerProxy: Address; owner: Address };

/** Short, human message from a viem/wagmi error (first line; prefers viem's `shortMessage`). */
export function errorMessage(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: string; message?: string };
    const m = e.shortMessage ?? e.message;
    if (m) return m.split("\n")[0] ?? m;
  }
  return "Transaction failed";
}

export function useCreatePortfolio() {
  const { address, chainId: walletChainId } = useAccount();
  const [pending, setPending] = useState(false);
  const config = useConfig();

  const create = useCallback(
    async (input: CreatePortfolioInput): Promise<CreatePortfolioResult> => {
      if (!address) throw new Error("Connect a wallet first");
      if (!isFeatureEnabled(input.chainId, "create")) throw new Error("Portfolio creation is disabled on this chain");
      if (walletChainId !== input.chainId) throw new Error(`Switch your wallet to ${getChain(input.chainId)?.name ?? input.chainId} first`);
      const fundDeployer = getFundDeployer(input.chainId);
      if (!fundDeployer) throw new Error("Protocol not deployed on this chain");
      setPending(true);
      try {
        // fees / policies are not configurable in the UI yet: empty config = no fees, no policies
        return await createPortfolioFlow(config, {
          chainId: input.chainId, account: address, fundDeployer, name: input.name, symbol: input.symbol,
          denominationAsset: input.denominationAsset, sharesActionTimelock: input.sharesActionTimelock,
        });
      } finally {
        setPending(false);
      }
    },
    [address, config, walletChainId],
  );

  return { create, pending };
}

export type DenominationStatus = "idle" | "loading" | "supported" | "unsupported" | "unknown";

/**
 * Checks that `asset` can be a denomination asset on this chain: `FundDeployer.createNewFund` -> `ComptrollerLib.init` requires
 * `ValueInterpreter.isSupportedPrimitiveAsset(asset)` ("init: Bad denomination asset" otherwise). The ValueInterpreter comes
 * from the deployment record / env, else from `FundDeployer.getComptrollerLib().getValueInterpreter()`. Also reads
 * symbol/decimals so amounts are always formatted with the token's real decimals.
 */
export function useDenominationCheck(chainId: number, asset: Address | undefined) {
  const deployment = getChainDeployment(chainId);
  const fundDeployer = deployment.fundDeployer ?? undefined;
  const recordVi = deployment.addresses.valueInterpreter;

  const lib = useReadContract({
    chainId, address: fundDeployer, abi: fundDeployerAbi, functionName: "getComptrollerLib",
    query: { enabled: !!fundDeployer && !recordVi },
  });
  const discoveredVi = useReadContract({
    chainId, address: lib.data, abi: comptrollerAbi, functionName: "getValueInterpreter",
    query: { enabled: !!lib.data && !recordVi },
  });
  const valueInterpreter = recordVi ?? discoveredVi.data;

  const reads = useReadContracts({
    allowFailure: true,
    query: { enabled: !!asset },
    contracts: [
      { chainId, address: valueInterpreter, abi: valueInterpreterAbi, functionName: "isSupportedPrimitiveAsset", args: [asset ?? "0x0000000000000000000000000000000000000000"] },
      { chainId, address: asset, abi: erc20Abi, functionName: "symbol" },
      { chainId, address: asset, abi: erc20Abi, functionName: "decimals" },
    ],
  });
  const [supported, symbol, decimals] = reads.data ?? [];
  let status: DenominationStatus = "idle";
  if (asset) {
    if (reads.isLoading || (!valueInterpreter && (lib.isLoading || discoveredVi.isLoading))) status = "loading";
    else if (!valueInterpreter || supported?.status !== "success") status = "unknown";
    else status = supported.result ? "supported" : "unsupported";
  }
  return {
    status,
    valueInterpreter,
    symbol: symbol?.status === "success" ? (symbol.result as string) : undefined,
    decimals: decimals?.status === "success" ? Number(decimals.result) : undefined,
  };
}

export type DeploymentHealth = "checking" | "ok" | "no-code" | "not-live" | "unreachable" | "none";

/**
 * Is the configured FundDeployer really there? Catches the classic QA mistake of a build pointed at addresses from a fork
 * while the RPC for that chain is not the fork (no code at the address), and a release that has not been set live.
 */
export function useDeploymentHealth(chainId: number): DeploymentHealth {
  const fundDeployer = getFundDeployer(chainId) ?? undefined;
  const code = useBytecode({ chainId, address: fundDeployer, query: { enabled: !!fundDeployer, retry: 1 } });
  const live = useReadContract({
    chainId, address: fundDeployer, abi: fundDeployerAbi, functionName: "releaseIsLive",
    query: { enabled: !!fundDeployer && !!code.data && code.data !== "0x", retry: 1 },
  });
  if (!fundDeployer) return "none";
  if (code.isLoading) return "checking";
  if (code.isError) return "unreachable";
  if (!code.data || code.data === "0x") return "no-code";
  if (live.isLoading) return "checking";
  if (live.data === false) return "not-live";
  return "ok";
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

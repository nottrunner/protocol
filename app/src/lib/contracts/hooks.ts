"use client";

import { useCallback, useState } from "react";
import { isAddress, type Address, type Hash } from "viem";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useBytecode, useConfig, useReadContract, useReadContracts, type Config } from "wagmi";
import { getPublicClient, readContract } from "wagmi/actions";
import { isFeatureEnabled } from "@/config/features";
import { comptrollerAbi, erc20Abi, fundDeployerAbi, valueInterpreterAbi } from "./abis";
import { getChain, supportedChainIds } from "@/config/chains";
import { getChainDeployment, getFundDeployer } from "./addresses";
import type { Redemption } from "./calls";
import { createPortfolioFlow, depositFlow, quoteDeposit, redeemFlow } from "./flows";
import { readPortfolio, readTokenInfo, readValuation, type PortfolioData, type TokenInfo } from "./portfolio";
import { prepareSwap, swapFlow, type PreparedSwap } from "./swap";
import type { SwapAdapter } from "@/lib/deployments";
import { scanLogsPaged, scanStartBlock } from "./listing";
import { UNVERIFIED_MESSAGES, verifyVault, type UnverifiedReason, type VaultVerification } from "./verify";

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

/** Reads a portfolio (vault) on an explicit chain: holdings, supply, the account's shares and manager status. */
export function usePortfolio(chainId: number, vault: string | undefined) {
  const config = useConfig();
  const { address: account } = useAccount();
  const valid = !!vault && isAddress(vault);
  const q = useQuery({
    queryKey: ["portfolio", chainId, vault?.toLowerCase(), account?.toLowerCase()],
    enabled: valid,
    retry: 1,
    refetchInterval: 20_000,
    queryFn: () => readPortfolio(config, { chainId, vault: vault as Address, account }),
  });
  return { valid, data: q.data, isLoading: valid && q.isLoading, isError: !valid || q.isError, error: q.error, refetch: q.refetch };
}

export type VaultVerificationState =
  | { state: "loading" }
  | { state: "verified"; fundDeployer: Address }
  | { state: "unverified"; reason: UnverifiedReason; message: string; detail?: string };

/**
 * Dispatcher check for the URL's chain + vault (see verify.ts). Fails closed: only `state === "verified"` may enable a
 * transaction UI; `loading` and every error / mismatch / unknown state keeps it disabled.
 */
export function useVaultVerification(chainId: number, vault: string | undefined, comptroller: Address | undefined): VaultVerificationState {
  const config = useConfig();
  const fundDeployer = getChainDeployment(chainId).fundDeployer;
  const q = useQuery({
    queryKey: ["vault-verification", chainId, vault?.toLowerCase(), comptroller?.toLowerCase(), fundDeployer?.toLowerCase()],
    enabled: !!vault && !!fundDeployer && !!comptroller,
    retry: 0,
    staleTime: 15_000,
    queryFn: () => verifyVault(config, { chainId, vault: vault as string, comptroller }),
  });
  const wrap = (v: VaultVerification): VaultVerificationState =>
    v.status === "verified" ? { state: "verified", fundDeployer: v.fundDeployer } : { state: "unverified", reason: v.reason, message: UNVERIFIED_MESSAGES[v.reason], detail: v.detail };
  if (!vault || !isAddress(vault)) return wrap({ status: "unverified", reason: "invalid-vault" });
  if (!fundDeployer) return wrap({ status: "unverified", reason: "no-fund-deployer" });
  if (q.isError) return wrap({ status: "unverified", reason: "dispatcher-error", detail: errorMessage(q.error) });
  if (!q.data) return { state: "loading" };
  return wrap(q.data);
}

/** NAV / share price via eth_call. Router comes from the deployment (record/env); without it only GAV + gross price show. */
export function useValuation(chainId: number, portfolio: PortfolioData | undefined) {
  const config = useConfig();
  const router = getChainDeployment(chainId).addresses.fundValueCalculatorRouter;
  const sig = portfolio ? `${portfolio.totalSupply}:${portfolio.holdings.map((h) => h.balance).join(",")}` : "";
  return useQuery({
    queryKey: ["valuation", chainId, portfolio?.vault.toLowerCase(), sig],
    enabled: !!portfolio,
    retry: 0,
    queryFn: () => readValuation(config, { chainId, portfolio: portfolio as PortfolioData, router }),
  });
}

export function useTokenBalance(chainId: number, token: Address | undefined) {
  const config = useConfig();
  const { address } = useAccount();
  const q = useQuery({
    queryKey: ["token-balance", chainId, token?.toLowerCase(), address?.toLowerCase()],
    enabled: !!token && !!address,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [symbol, decimals, balance] = await Promise.all([
        readContract(config, { chainId, address: token as Address, abi: erc20Abi, functionName: "symbol" }),
        readContract(config, { chainId, address: token as Address, abi: erc20Abi, functionName: "decimals" }),
        readContract(config, { chainId, address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] }),
      ]);
      return { symbol, decimals: Number(decimals), balance };
    },
  });
  return { symbol: q.data?.symbol, decimals: q.data?.decimals, balance: q.data?.balance, refetch: q.refetch };
}

/** Live preview of a deposit: share price, expected shares and the `minSharesQuantity` that will be sent. */
export function useDepositQuote(chainId: number, comptroller: Address | undefined, amount: bigint | undefined, slippageBps: number) {
  const config = useConfig();
  return useQuery({
    queryKey: ["deposit-quote", chainId, comptroller?.toLowerCase(), amount?.toString(), slippageBps],
    enabled: !!comptroller && !!amount && amount > BigInt(0),
    retry: 0,
    queryFn: () => quoteDeposit(config, { chainId, comptroller: comptroller as Address, amount: amount as bigint, slippageBps }),
  });
}

function useWalletFlow<A extends unknown[], R>(chainId: number, feature: "deposit" | "redeem", run: (config: Config, account: Address, ...a: A) => Promise<R>) {
  const config = useConfig();
  const { address, chainId: walletChainId } = useAccount();
  const [pending, setPending] = useState(false);
  const exec = useCallback(
    async (...a: A): Promise<R> => {
      if (!address) throw new Error("Connect a wallet first");
      if (!isFeatureEnabled(chainId, feature)) throw new Error(`${feature === "deposit" ? "Deposits are" : "Redemptions are"} disabled on this chain`);
      if (walletChainId !== chainId) throw new Error(`Switch your wallet to ${getChain(chainId)?.name ?? chainId} first`);
      setPending(true);
      try {
        return await run(config, address, ...a);
      } finally {
        setPending(false);
      }
    },
    [address, chainId, config, feature, run, walletChainId],
  );
  return { exec, pending };
}

export function useDeposit(chainId: number, vault: Address | undefined, comptroller: Address | undefined, denominationAsset: Address | undefined) {
  const run = useCallback(
    (config: Config, account: Address, amount: bigint, slippageBps: number) => {
      if (!vault || !comptroller || !denominationAsset) throw new Error("Vault not ready");
      return depositFlow(config, { chainId, account, vault, comptroller, denominationAsset, amount, slippageBps });
    },
    [chainId, vault, comptroller, denominationAsset],
  );
  const { exec, pending } = useWalletFlow(chainId, "deposit", run);
  return { deposit: exec, pending };
}

export function useRedeem(chainId: number, vault: Address | undefined, comptroller: Address | undefined) {
  const run = useCallback(
    (config: Config, account: Address, redemption: Redemption) => {
      if (!vault || !comptroller) throw new Error("Vault not ready");
      return redeemFlow(config, { chainId, account, vault, comptroller, redemption });
    },
    [chainId, vault, comptroller],
  );
  const { exec, pending } = useWalletFlow(chainId, "redeem", run);
  return { redeem: exec, pending };
}

/** symbol/decimals of any ERC-20 on the chain (undefined while loading / if not a token). */
export function useTokenInfo(chainId: number, token: string | undefined) {
  const config = useConfig();
  const valid = !!token && isAddress(token);
  const q = useQuery({
    queryKey: ["token-info", chainId, token?.toLowerCase()],
    enabled: valid,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TokenInfo> => {
      const info = await readTokenInfo(config, chainId, token as Address);
      if (info.symbol === "???") throw new Error("Not an ERC-20 token on this chain");
      return info;
    },
  });
  return { info: q.data, isLoading: valid && q.isLoading, isError: valid && q.isError };
}

export type PrepareSwapInput = {
  route: SwapAdapter; tokenIn: TokenInfo; tokenOut: TokenInfo; amountIn: bigint; slippageBps: number; excludeDexes?: string[];
};

/** Quote (prepare) and execute swaps for a vault. Both use the URL chain; execution needs the wallet on that chain. */
export function useSwap(portfolio: PortfolioData | undefined) {
  const config = useConfig();
  const { address, chainId: walletChainId } = useAccount();
  const [pending, setPending] = useState(false);
  const prepare = useCallback(
    async (i: PrepareSwapInput): Promise<PreparedSwap> => {
      if (!portfolio) throw new Error("Vault not ready");
      return prepareSwap(config, (url, init) => fetch(url, init), {
        chainId: portfolio.chainId, vault: portfolio.vault, comptroller: portfolio.comptroller, route: i.route,
        tokenIn: i.tokenIn, tokenOut: i.tokenOut, amountIn: i.amountIn, slippageBps: i.slippageBps, excludeDexes: i.excludeDexes,
      });
    },
    [config, portfolio],
  );
  const execute = useCallback(
    async (prepared: PreparedSwap) => {
      if (!portfolio || !address) throw new Error("Connect a wallet first");
      if (walletChainId !== portfolio.chainId) throw new Error(`Switch your wallet to ${getChain(portfolio.chainId)?.name ?? portfolio.chainId} first`);
      setPending(true);
      try {
        return await swapFlow(config, { chainId: portfolio.chainId, account: address, vault: portfolio.vault, comptroller: portfolio.comptroller, prepared });
      } finally {
        setPending(false);
      }
    },
    [address, config, portfolio, walletChainId],
  );
  return { prepare, execute, pending };
}

export type MyPortfolio = { vault: Address; comptroller?: Address; blockNumber?: bigint; source: "logs" | "saved" };

/**
 * Portfolios created by `account`, from FundDeployer NewFundCreated logs (indexed `creator`), scanned newest -> oldest in
 * adaptive chunks from the deployment record's block. `complete=false` means the RPC refused some ranges: the UI offers the
 * paste-a-vault fallback.
 */
export function useMyPortfolios(chainId: number, account: Address | undefined) {
  const config = useConfig();
  const deployment = getChainDeployment(chainId);
  const fundDeployer = deployment.fundDeployer ?? undefined;
  const q = useQuery({
    queryKey: ["my-portfolios", chainId, account?.toLowerCase(), fundDeployer, deployment.fromBlock?.toString() ?? "-"],
    enabled: !!account && !!fundDeployer,
    retry: 0,
    queryFn: async () => {
      const client = getPublicClient(config, { chainId });
      if (!client) throw new Error("No client for chain");
      const latest = await client.getBlockNumber();
      const { from, bounded } = scanStartBlock(chainId, deployment.fromBlock, latest);
      const res = await scanLogsPaged({
        fromBlock: from, toBlock: latest,
        fetchRange: async (a, b) => {
          const logs = await client.getContractEvents({
            address: fundDeployer, abi: fundDeployerAbi, eventName: "NewFundCreated", args: { creator: account }, fromBlock: a, toBlock: b,
          });
          return logs.map((l) => ({ vault: l.args.vaultProxy as Address, comptroller: l.args.comptrollerProxy as Address, blockNumber: l.blockNumber }));
        },
      });
      return { ...res, from, bounded, latest };
    },
  });
  return { ...q, scan: q.data };
}

/** Resolved deployment (record + env overrides) for a chain. Static for the lifetime of the build. */
export function useDeployment(chainId: number) {
  return getChainDeployment(chainId);
}

/** True if any supported chain's addresses come from a fork / unlabelled record (QA builds only). */
export function anyForkDeployment(): boolean {
  return supportedChainIds.some((id) => getChainDeployment(id).isFork);
}

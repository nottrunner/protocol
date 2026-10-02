import { isAddress, zeroAddress, type Address } from "viem";
import type { Config } from "wagmi";
import { readContract, simulateContract } from "wagmi/actions";
import { comptrollerAbi, erc20Abi, fundValueCalculatorRouterAbi, valueInterpreterAbi, vaultAbi } from "./abis";

/**
 * Read side of a portfolio, as plain async functions over a wagmi Config. Individual eth_calls (no multicall3 dependency:
 * Robinhood Chain has no verified multicall3). Everything is read on the explicit `chainId`, never the wallet's chain, so
 * /portfolio/<chain>/<vault> renders identically before/after a wallet connects and after a reload.
 */

export type TokenInfo = { address: Address; symbol: string; decimals: number };
export type Holding = TokenInfo & { balance: bigint; /** value in the denomination asset (undefined if unpriceable) */ value?: bigint };

export type PortfolioData = {
  chainId: number;
  vault: Address;
  comptroller: Address;
  name: string;
  symbol: string;
  owner: Address;
  totalSupply: bigint;
  denomination: TokenInfo;
  holdings: Holding[];
  sharesActionTimelock: bigint;
  /** present when an account was given */
  account?: {
    address: Address;
    shares: bigint;
    canManageAssets: boolean;
    /** unix seconds before which this account cannot redeem (0 = not locked) */
    lockedUntil: bigint;
  };
};

export async function readTokenInfo(config: Config, chainId: number, address: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    readContract(config, { chainId, address, abi: erc20Abi, functionName: "symbol" }).catch(() => "???"),
    readContract(config, { chainId, address, abi: erc20Abi, functionName: "decimals" }).catch(() => 18),
  ]);
  return { address, symbol, decimals: Number(decimals) };
}

export async function readPortfolio(
  config: Config,
  args: { chainId: number; vault: Address; account?: Address },
): Promise<PortfolioData> {
  const { chainId, vault, account } = args;
  if (!isAddress(vault)) throw new Error("Invalid vault address");
  const r = <T extends keyof VaultFns>(fn: T) => readContract(config, { chainId, address: vault, abi: vaultAbi, functionName: fn } as never) as Promise<VaultFns[T]>;
  // getAccessor is the proof this is a vault proxy; it throws (execution reverted / no data) for anything else.
  const comptroller = (await r("getAccessor")) as Address;
  if (!comptroller || comptroller === zeroAddress) throw new Error("Not a vault (no accessor)");
  const [name, symbol, owner, totalSupply, tracked, denominationAddr, timelock] = await Promise.all([
    r("name"), r("symbol"), r("getOwner"), r("totalSupply"), r("getTrackedAssets"),
    readContract(config, { chainId, address: comptroller, abi: comptrollerAbi, functionName: "getDenominationAsset" }),
    readContract(config, { chainId, address: comptroller, abi: comptrollerAbi, functionName: "getSharesActionTimelock" }),
  ]);
  const denomination = await readTokenInfo(config, chainId, denominationAddr);
  const assets = [...new Set(tracked.map((a) => a.toLowerCase()))].map((l) => tracked.find((a) => a.toLowerCase() === l)!);
  const holdings = await Promise.all(
    assets.map(async (asset): Promise<Holding> => {
      const info = asset === denomination.address ? denomination : await readTokenInfo(config, chainId, asset);
      const balance = await readContract(config, { chainId, address: asset, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
      return { ...info, balance };
    }),
  );

  let acct: PortfolioData["account"];
  if (account) {
    const [shares, canManage, lastBought] = await Promise.all([
      readContract(config, { chainId, address: vault, abi: vaultAbi, functionName: "balanceOf", args: [account] }),
      readContract(config, { chainId, address: vault, abi: vaultAbi, functionName: "canManageAssets", args: [account] }),
      readContract(config, { chainId, address: comptroller, abi: comptrollerAbi, functionName: "getLastSharesBoughtTimestampForAccount", args: [account] }),
    ]);
    acct = { address: account, shares, canManageAssets: canManage, lockedUntil: lastBought === BigInt(0) ? BigInt(0) : lastBought + timelock };
  }
  return {
    chainId, vault, comptroller, name: name as string, symbol: symbol as string, owner: owner as Address, totalSupply: totalSupply as bigint,
    denomination, holdings, sharesActionTimelock: timelock, account: acct,
  };
}

type VaultFns = {
  getAccessor: Address; name: string; symbol: string; getOwner: Address; totalSupply: bigint; getTrackedAssets: readonly Address[];
};

export type Valuation = {
  /** gross asset value in denomination units */
  gav?: bigint;
  /** value of 1e18 shares ignoring outstanding fees (from the Comptroller) */
  grossSharePrice?: bigint;
  /** value of 1e18 shares after fees (from the FundValueCalculatorRouter, when configured) */
  netSharePrice?: bigint;
  /** net asset value = totalSupply * net share price / 1e18 (router) */
  nav?: bigint;
  /** per-asset values in denomination units, by lowercase asset address */
  assetValues: Record<string, bigint>;
  /** why a number is missing (stale feed, no router, ...) */
  errors: string[];
};

const msg = (e: unknown) => ((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? String(e)).split("\n")[0] ?? "error";

/**
 * Valuation via eth_call. calcGav / calcGrossShareValue / calcNav are non-view in Enzyme (price-feed reads may touch third-party
 * state), so they are simulated. Each value is independent: one failing (e.g. a stale Chainlink feed fails closed) does not hide
 * the others.
 */
export async function readValuation(
  config: Config,
  args: { chainId: number; portfolio: PortfolioData; router?: Address },
): Promise<Valuation> {
  const { chainId, portfolio: p, router } = args;
  const out: Valuation = { assetValues: {}, errors: [] };
  const sim = <T>(fn: () => Promise<{ result: T }>) => fn().then((r) => r.result);
  const [gav, gross] = await Promise.allSettled([
    sim(() => simulateContract(config, { chainId, address: p.comptroller, abi: comptrollerAbi, functionName: "calcGav" })),
    sim(() => simulateContract(config, { chainId, address: p.comptroller, abi: comptrollerAbi, functionName: "calcGrossShareValue" })),
  ]);
  if (gav.status === "fulfilled") out.gav = gav.value;
  else out.errors.push(`GAV unavailable: ${msg(gav.reason)}`);
  if (gross.status === "fulfilled") out.grossSharePrice = gross.value;
  else out.errors.push(`Share price unavailable: ${msg(gross.reason)}`);

  if (router) {
    const [net, nav] = await Promise.allSettled([
      sim(() => simulateContract(config, { chainId, address: router, abi: fundValueCalculatorRouterAbi, functionName: "calcNetShareValue", args: [p.vault] })),
      sim(() => simulateContract(config, { chainId, address: router, abi: fundValueCalculatorRouterAbi, functionName: "calcNav", args: [p.vault] })),
    ]);
    if (net.status === "fulfilled") out.netSharePrice = net.value[1];
    else out.errors.push(`Net share price unavailable: ${msg(net.reason)}`);
    if (nav.status === "fulfilled") out.nav = nav.value[1];
    else out.errors.push(`NAV unavailable: ${msg(nav.reason)}`);
  }

  const vi = await readContract(config, { chainId, address: p.comptroller, abi: comptrollerAbi, functionName: "getValueInterpreter" }).catch(() => undefined);
  if (vi) {
    await Promise.all(
      p.holdings.map(async (h) => {
        if (h.address.toLowerCase() === p.denomination.address.toLowerCase()) {
          out.assetValues[h.address.toLowerCase()] = h.balance;
          return;
        }
        if (h.balance === BigInt(0)) {
          out.assetValues[h.address.toLowerCase()] = BigInt(0);
          return;
        }
        try {
          const { result } = await simulateContract(config, {
            chainId, address: vi, abi: valueInterpreterAbi, functionName: "calcCanonicalAssetValue", args: [h.address, h.balance, p.denomination.address],
          });
          out.assetValues[h.address.toLowerCase()] = result;
        } catch (e) {
          out.errors.push(`${h.symbol} value unavailable: ${msg(e)}`);
        }
      }),
    );
  }
  return out;
}

/** Expected in-kind payout for redeeming `shares`: balance * shares / totalSupply for each holding (floor, like the contract). */
export function previewInKindRedemption(holdings: readonly Holding[], shares: bigint, totalSupply: bigint): { asset: Holding; amount: bigint }[] {
  if (totalSupply <= BigInt(0)) return [];
  return holdings.map((h) => ({ asset: h, amount: (h.balance * shares) / totalSupply }));
}

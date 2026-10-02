import {
  decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbiParameters, parseEventLogs, toFunctionSelector,
  type Address, type Hex, type Log,
} from "viem";
import type { Config } from "wagmi";
import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { SwapAdapter, SwapAdapterKind } from "@/lib/deployments";
import { augustusV6Abi, comptrollerAbi, integrationManagerAbi, quoterV2Abi } from "./abis";
import { BPS } from "./calls";

/**
 * Swaps = `Comptroller.callOnExtension(IntegrationManager, 0 /* callOnIntegration *\/, abi.encode(adapter, selector, integrationData))`.
 * The adapter's `parseAssetsForAction` derives spend/incoming assets from `integrationData`, the IntegrationManager pulls the
 * spend asset from the vault, runs the adapter, enforces min incoming amounts and tracks the incoming asset. Only the vault owner
 * or an asset manager may call it (`VaultLib.canManageAssets`).
 */

/** AdapterBase.TAKE_ORDER_SELECTOR (Uniswap V3 adapters) */
export const TAKE_ORDER_SELECTOR: Hex = toFunctionSelector("takeOrder(address,bytes,bytes)");
/** AdapterBase.ACTION_SELECTOR (ParaSwapV6Adapter) */
export const ACTION_SELECTOR: Hex = toFunctionSelector("action(address,bytes,bytes)");
/** IntegrationManager action id for callOnIntegration */
export const CALL_ON_INTEGRATION_ACTION = BigInt(0);

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("slippage must be 0-9999 bps");
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
}

// ---- Uniswap V3 ---------------------------------------------------------------------------------------------------------

export type UniPath = { tokens: Address[]; fees: number[] };

/** Packed Uniswap V3 path: token0 | fee0 (3 bytes) | token1 | fee1 | token2 ... */
export function encodeUniPath(path: UniPath): Hex {
  if (path.tokens.length < 2 || path.tokens.length !== path.fees.length + 1) throw new Error("bad path");
  const types: ("address" | "uint24")[] = ["address"];
  const values: (Address | number)[] = [path.tokens[0]!];
  path.fees.forEach((fee, i) => {
    types.push("uint24", "address");
    values.push(fee, path.tokens[i + 1]!);
  });
  return encodePacked(types, values);
}

export const UNI_FEE_TIERS = [500, 3000, 10000, 100] as const;

/** Candidate routes: every direct fee tier, plus 2-hop via WETH for the two main tier combinations. */
export function uniCandidates(tokenIn: Address, tokenOut: Address, weth?: Address): UniPath[] {
  const out: UniPath[] = UNI_FEE_TIERS.map((f) => ({ tokens: [tokenIn, tokenOut], fees: [f] }));
  const same = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  if (weth && !same(tokenIn, weth) && !same(tokenOut, weth)) {
    for (const f1 of [500, 3000]) for (const f2 of [500, 3000]) out.push({ tokens: [tokenIn, weth, tokenOut], fees: [f1, f2] });
  }
  return out;
}

export type UniQuote = { path: UniPath; amountOut: bigint };

/** Best exact-in quote across candidate paths using QuoterV2 (eth_call). Throws if no pool quotes. */
export async function quoteUniswap(
  config: Config,
  args: { chainId: number; quoter: Address; tokenIn: Address; tokenOut: Address; amountIn: bigint; weth?: Address },
): Promise<UniQuote> {
  const cands = uniCandidates(args.tokenIn, args.tokenOut, args.weth);
  const results = await Promise.allSettled(
    cands.map(async (path) => {
      const { result } = await simulateContract(config, {
        chainId: args.chainId, address: args.quoter, abi: quoterV2Abi, functionName: "quoteExactInput", args: [encodeUniPath(path), args.amountIn],
      });
      return { path, amountOut: result[0] } satisfies UniQuote;
    }),
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" && r.value.amountOut > BigInt(0) ? [r.value] : []));
  if (ok.length === 0) throw new Error("No Uniswap V3 pool quoted this pair (no liquidity on the tried fee tiers / WETH routes)");
  return ok.reduce((best, q) => (q.amountOut > best.amountOut ? q : best));
}

/** `integrationData` for UniswapV3Adapter / UniswapV3SwapRouter02Adapter `takeOrder`: (address[] path, uint24[] fees, uint256 amountIn, uint256 minOut) */
export function encodeUniTakeOrder(path: UniPath, amountIn: bigint, minOut: bigint): Hex {
  return encodeAbiParameters(parseAbiParameters("address[], uint24[], uint256, uint256"), [path.tokens, path.fees, amountIn, minOut]);
}

// ---- ParaSwap v6 (Velora) -----------------------------------------------------------------------------------------------

export const PARASWAP_API = "https://api.paraswap.io";

export type ParaSwapActionArgs = {
  executor: Address;
  swapData: { srcToken: Address; destToken: Address; fromAmount: bigint; toAmount: bigint; quotedAmount: bigint; metadata: Hex };
  partnerAndFee: bigint;
  executorData: Hex;
};

/** Decodes Augustus V6 `swapExactAmountIn` calldata (as returned by the Velora API) into the adapter's SwapActionArgs. */
export function decodeAugustusSwapExactAmountIn(data: Hex): ParaSwapActionArgs {
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: augustusV6Abi, data });
  } catch {
    throw new Error("ParaSwap returned a route method the ParaSwapV6Adapter does not support (only swapExactAmountIn); try again or use the Uniswap route");
  }
  const [executor, sd, partnerAndFee, , executorData] = decoded.args;
  return {
    executor,
    swapData: { srcToken: sd.srcToken, destToken: sd.destToken, fromAmount: sd.fromAmount, toAmount: sd.toAmount, quotedAmount: sd.quotedAmount, metadata: sd.metadata },
    partnerAndFee,
    executorData,
  };
}

/** ParaSwapV6Adapter `action` data: abi.encode(Action.SwapExactAmountIn (0), abi.encode(SwapActionArgs)). */
export function encodeParaSwapAction(a: ParaSwapActionArgs): Hex {
  const inner = encodeAbiParameters(
    parseAbiParameters(
      "(address executor, (address srcToken, address destToken, uint256 fromAmount, uint256 toAmount, uint256 quotedAmount, bytes32 metadata) swapData, uint256 partnerAndFee, bytes executorData)",
    ),
    [a],
  );
  return encodeAbiParameters(parseAbiParameters("uint8, bytes"), [0, inner]);
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type ParaSwapQuote = { expectedOut: bigint; minOut: bigint; action: ParaSwapActionArgs; priceRouteBlock?: number };

/**
 * Quote + calldata from the Velora (ParaSwap) API for an exact-in swap executed by `vault`, restricted to the generic
 * `swapExactAmountIn` method (the only one ParaSwapV6Adapter wraps). The API's calldata is decoded and re-encoded for the adapter;
 * its `toAmount` already contains the requested slippage. The API prices against LIVE chain state, so against a stale local fork
 * the route may revert: the pre-send simulation shows that.
 */
export async function quoteParaSwap(
  fetchFn: FetchLike,
  args: { chainId: number; vault: Address; tokenIn: Address; tokenOut: Address; decimalsIn: number; decimalsOut: number; amountIn: bigint; slippageBps: number; apiBase?: string },
): Promise<ParaSwapQuote> {
  const base = args.apiBase ?? PARASWAP_API;
  const q = new URLSearchParams({
    srcToken: args.tokenIn, destToken: args.tokenOut, amount: args.amountIn.toString(), srcDecimals: String(args.decimalsIn),
    destDecimals: String(args.decimalsOut), side: "SELL", network: String(args.chainId), version: "6.2",
    includeContractMethods: "swapExactAmountIn", userAddress: args.vault,
  });
  const pr = await fetchFn(`${base}/prices?${q}`);
  const prBody = (await pr.json()) as { priceRoute?: { destAmount?: string; blockNumber?: number }; error?: string };
  if (!pr.ok || !prBody.priceRoute?.destAmount) throw new Error(`ParaSwap price request failed: ${prBody.error ?? pr.status}`);
  const tx = await fetchFn(`${base}/transactions/${args.chainId}?ignoreChecks=true&ignoreGasEstimate=true`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      srcToken: args.tokenIn, destToken: args.tokenOut, srcAmount: args.amountIn.toString(), srcDecimals: args.decimalsIn,
      destDecimals: args.decimalsOut, slippage: args.slippageBps, priceRoute: prBody.priceRoute, userAddress: args.vault, receiver: args.vault,
    }),
  });
  const txBody = (await tx.json()) as { data?: Hex; error?: string };
  if (!tx.ok || !txBody.data) throw new Error(`ParaSwap transaction build failed: ${txBody.error ?? tx.status}`);
  const action = decodeAugustusSwapExactAmountIn(txBody.data);
  if (action.swapData.srcToken.toLowerCase() !== args.tokenIn.toLowerCase() || action.swapData.destToken.toLowerCase() !== args.tokenOut.toLowerCase()) {
    throw new Error("ParaSwap returned a route for different tokens");
  }
  if (action.swapData.fromAmount !== args.amountIn) throw new Error("ParaSwap returned a different input amount");
  return { expectedOut: BigInt(prBody.priceRoute.destAmount), minOut: action.swapData.toAmount, action, priceRouteBlock: prBody.priceRoute.blockNumber };
}

// ---- prepare + execute ------------------------------------------------------------------------------------------------

export type PreparedSwap = {
  route: SwapAdapter;
  selector: Hex;
  integrationData: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedOut: bigint;
  minOut: bigint;
  /** human description of the path, e.g. "USDC -(0.05%)-> WETH" */
  description: string;
};

export function selectorFor(kind: SwapAdapterKind): Hex {
  return kind === "paraSwapV6" ? ACTION_SELECTOR : TAKE_ORDER_SELECTOR;
}

/** abi.encode(adapter, selector, integrationData): the `_callArgs` of IntegrationManager action 0. */
export function encodeCallOnIntegrationArgs(adapter: Address, selector: Hex, integrationData: Hex): Hex {
  return encodeAbiParameters(parseAbiParameters("address, bytes4, bytes"), [adapter, selector, integrationData]);
}

export function encodeSwapCallOnExtension(integrationManager: Address, p: Pick<PreparedSwap, "route" | "selector" | "integrationData">): Hex {
  return encodeFunctionData({
    abi: comptrollerAbi, functionName: "callOnExtension",
    args: [integrationManager, CALL_ON_INTEGRATION_ACTION, encodeCallOnIntegrationArgs(p.route.address, p.selector, p.integrationData)],
  });
}

export async function prepareSwap(
  config: Config,
  fetchFn: FetchLike,
  args: {
    chainId: number; vault: Address; comptroller: Address; route: SwapAdapter;
    tokenIn: { address: Address; symbol: string; decimals: number }; tokenOut: { address: Address; symbol: string; decimals: number };
    amountIn: bigint; slippageBps: number;
  },
): Promise<PreparedSwap> {
  const { route, tokenIn, tokenOut, amountIn, slippageBps } = args;
  if (route.kind === "paraSwapV6") {
    const q = await quoteParaSwap(fetchFn, {
      chainId: args.chainId, vault: args.vault, tokenIn: tokenIn.address, tokenOut: tokenOut.address,
      decimalsIn: tokenIn.decimals, decimalsOut: tokenOut.decimals, amountIn, slippageBps,
    });
    return {
      route, selector: ACTION_SELECTOR, integrationData: encodeParaSwapAction(q.action), tokenIn: tokenIn.address, tokenOut: tokenOut.address,
      amountIn, expectedOut: q.expectedOut, minOut: q.minOut, description: `${tokenIn.symbol} -> ${tokenOut.symbol} via ParaSwap`,
    };
  }
  if (!route.quoter) throw new Error("No Uniswap QuoterV2 configured for this chain");
  const weth = await readContract(config, { chainId: args.chainId, address: args.comptroller, abi: comptrollerAbi, functionName: "getWethToken" }).catch(() => undefined);
  const best = await quoteUniswap(config, { chainId: args.chainId, quoter: route.quoter, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn, weth });
  const minOut = applySlippage(best.amountOut, slippageBps);
  return {
    route, selector: TAKE_ORDER_SELECTOR, integrationData: encodeUniTakeOrder(best.path, amountIn, minOut), tokenIn: tokenIn.address, tokenOut: tokenOut.address,
    amountIn, expectedOut: best.amountOut, minOut,
    description: [tokenIn.symbol, ...best.path.fees.flatMap((f, i) => [`-(${f / 10_000}%)->`, i === best.path.fees.length - 1 ? tokenOut.symbol : "WETH"])].join(" "),
  };
}

export type SwapFlowResult = {
  txHash: Hex;
  /** the adapter address that ran (from the IntegrationManager's CallOnIntegrationExecutedForFund event) */
  adapter: Address;
  routeKind: SwapAdapterKind;
  routeLabel: string;
  spentAssets: readonly Address[];
  spentAmounts: readonly bigint[];
  incomingAssets: readonly Address[];
  incomingAmounts: readonly bigint[];
};

export function parseCallOnIntegration(logs: readonly Log[], integrationManager: Address) {
  const parsed = parseEventLogs({ abi: integrationManagerAbi, eventName: "CallOnIntegrationExecutedForFund", logs: logs as Log[] });
  return parsed.find((l) => l.address.toLowerCase() === integrationManager.toLowerCase());
}

export async function swapFlow(
  config: Config,
  args: { chainId: number; account: Address; comptroller: Address; prepared: PreparedSwap },
): Promise<SwapFlowResult> {
  const { chainId, account, comptroller, prepared } = args;
  const integrationManager = await readContract(config, { chainId, address: comptroller, abi: comptrollerAbi, functionName: "getIntegrationManager" });
  const callArgs = encodeCallOnIntegrationArgs(prepared.route.address, prepared.selector, prepared.integrationData);
  const callParams = {
    chainId, account, address: comptroller, abi: comptrollerAbi, functionName: "callOnExtension",
    args: [integrationManager, CALL_ON_INTEGRATION_ACTION, callArgs],
  } as const;
  await simulateContract(config, callParams);
  const txHash = await writeContract(config, callParams);
  const receipt = await waitForTransactionReceipt(config, { chainId, hash: txHash });
  if (receipt.status !== "success") throw new Error(`swap transaction reverted (${txHash})`);
  const evt = parseCallOnIntegration(receipt.logs, integrationManager);
  if (!evt) throw new Error("Transaction succeeded but no CallOnIntegrationExecutedForFund event was found");
  return {
    txHash, adapter: evt.args.adapter, routeKind: prepared.route.kind, routeLabel: prepared.route.label,
    spentAssets: evt.args.spendAssets, spentAmounts: evt.args.spendAssetAmounts,
    incomingAssets: evt.args.incomingAssets, incomingAmounts: evt.args.incomingAssetAmounts,
  };
}

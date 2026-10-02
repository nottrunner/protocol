import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, parseAbiParameters, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { augustusV6Abi, comptrollerAbi } from "./abis";
import {
  ACTION_SELECTOR, TAKE_ORDER_SELECTOR, applySlippage, decodeAugustusSwapExactAmountIn, encodeCallOnIntegrationArgs, encodeParaSwapAction,
  encodeSwapCallOnExtension, encodeUniPath, encodeUniTakeOrder, quoteParaSwap, selectorFor, uniCandidates, type FetchLike,
} from "./swap";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const DAI = "0x6B175474E89094C44Da98b954EedeAC495271d0F" as const;
const IM = "0x51A3063228F351481408CfEad5C865122A88a0b5" as const;
const ADAPTER = "0x8EfeFFeC35A075675FcF07E8D589eBc6F7c27F38" as const;
const VAULT = "0x1111111111111111111111111111111111111111" as const;

describe("selectors match the adapters", () => {
  it("takeOrder(address,bytes,bytes) / action(address,bytes,bytes)", () => {
    expect(TAKE_ORDER_SELECTOR).toBe(keccak256(toBytes("takeOrder(address,bytes,bytes)")).slice(0, 10));
    expect(ACTION_SELECTOR).toBe(keccak256(toBytes("action(address,bytes,bytes)")).slice(0, 10));
    expect(selectorFor("uniswapV3")).toBe(TAKE_ORDER_SELECTOR);
    expect(selectorFor("uniswapV3SwapRouter02")).toBe(TAKE_ORDER_SELECTOR);
    expect(selectorFor("paraSwapV6")).toBe(ACTION_SELECTOR);
  });
});

describe("Uniswap V3 encoding", () => {
  it("packs a path as token|fee(3 bytes)|token", () => {
    const p = encodeUniPath({ tokens: [USDC, WETH], fees: [500] });
    expect(p).toBe(`0x${USDC.slice(2)}0001f4${WETH.slice(2)}`.toLowerCase());
    const p2 = encodeUniPath({ tokens: [USDC, WETH, DAI], fees: [500, 3000] });
    expect(p2.length).toBe(2 + 2 * (20 + 3 + 20 + 3 + 20));
    expect(p2.slice(2 + 2 * 43, 2 + 2 * 43 + 6)).toBe("000bb8".replace("000bb8", "000bb8")); // second fee tier 3000 = 0x000bb8
  });
  it("rejects malformed paths", () => {
    expect(() => encodeUniPath({ tokens: [USDC], fees: [] })).toThrow();
    expect(() => encodeUniPath({ tokens: [USDC, WETH], fees: [] })).toThrow();
  });
  it("candidates: all direct tiers, plus WETH hops unless an end is WETH", () => {
    expect(uniCandidates(USDC, DAI, WETH)).toHaveLength(4 + 4);
    expect(uniCandidates(USDC, WETH, WETH)).toHaveLength(4);
    expect(uniCandidates(USDC, DAI)).toHaveLength(4);
  });
  it("takeOrder integrationData = (address[], uint24[], uint256 amountIn, uint256 minOut), as the adapter decodes", () => {
    const data = encodeUniTakeOrder({ tokens: [USDC, WETH], fees: [500] }, BigInt(1000), BigInt(900));
    const [tokens, fees, amountIn, minOut] = decodeAbiParameters(parseAbiParameters("address[], uint24[], uint256, uint256"), data);
    expect(tokens).toEqual([USDC, WETH]);
    expect(fees).toEqual([500]);
    expect(amountIn).toBe(BigInt(1000));
    expect(minOut).toBe(BigInt(900));
  });
  it("applySlippage", () => {
    expect(applySlippage(BigInt(10_000), 50)).toBe(BigInt(9_950));
    expect(() => applySlippage(BigInt(1), 10_000)).toThrow();
  });
});

describe("callOnExtension encoding", () => {
  it("callOnExtension(integrationManager, 0, abi.encode(adapter, selector, integrationData))", () => {
    const integrationData = encodeUniTakeOrder({ tokens: [USDC, WETH], fees: [500] }, BigInt(1000), BigInt(900));
    const data = encodeSwapCallOnExtension(IM, {
      route: { kind: "uniswapV3", address: ADAPTER, quoter: null, label: "x" }, selector: TAKE_ORDER_SELECTOR, integrationData,
    });
    const dec = decodeFunctionData({ abi: comptrollerAbi, data });
    expect(dec.functionName).toBe("callOnExtension");
    const [ext, actionId, callArgs] = dec.args as [string, bigint, `0x${string}`];
    expect(ext).toBe(IM);
    expect(actionId).toBe(BigInt(0));
    expect(callArgs).toBe(encodeCallOnIntegrationArgs(ADAPTER, TAKE_ORDER_SELECTOR, integrationData));
    const [adapter, selector, inner] = decodeAbiParameters(parseAbiParameters("address, bytes4, bytes"), callArgs);
    expect(adapter).toBe(ADAPTER);
    expect(selector).toBe(TAKE_ORDER_SELECTOR);
    expect(inner).toBe(integrationData);
  });
});

describe("ParaSwap v6", () => {
  const swapData = {
    srcToken: USDC, destToken: WETH, fromAmount: BigInt(1_000_000_000), toAmount: BigInt(300), quotedAmount: BigInt(303),
    metadata: `0x${"ab".repeat(32)}` as const, beneficiary: VAULT,
  };
  const calldata = encodeFunctionData({
    abi: augustusV6Abi, functionName: "swapExactAmountIn", args: [ADAPTER, swapData, BigInt(0), "0x", "0xdeadbeef"],
  });
  it("decodes Augustus swapExactAmountIn calldata into adapter SwapActionArgs (beneficiary and permit dropped)", () => {
    const a = decodeAugustusSwapExactAmountIn(calldata);
    expect(a.executor).toBe(ADAPTER);
    expect(a.swapData).toEqual({
      srcToken: USDC, destToken: WETH, fromAmount: BigInt(1_000_000_000), toAmount: BigInt(300), quotedAmount: BigInt(303), metadata: swapData.metadata,
    });
    expect(a.partnerAndFee).toBe(BigInt(0));
    expect(a.executorData).toBe("0xdeadbeef");
  });
  it("rejects other Augustus methods", () => {
    expect(() => decodeAugustusSwapExactAmountIn("0x12345678")).toThrow(/does not support/);
  });
  it("action data = (uint8 0, abi.encode(SwapActionArgs)) and round-trips through the adapter's decode", () => {
    const a = decodeAugustusSwapExactAmountIn(calldata);
    const data = encodeParaSwapAction(a);
    const [actionId, inner] = decodeAbiParameters(parseAbiParameters("uint8, bytes"), data);
    expect(actionId).toBe(0);
    const [args] = decodeAbiParameters(
      parseAbiParameters("(address executor, (address srcToken, address destToken, uint256 fromAmount, uint256 toAmount, uint256 quotedAmount, bytes32 metadata) swapData, uint256 partnerAndFee, bytes executorData)"),
      inner,
    );
    expect(args.executor).toBe(ADAPTER);
    expect(args.swapData.toAmount).toBe(BigInt(300));
    expect(args.executorData).toBe("0xdeadbeef");
    void encodeAbiParameters;
  });
  it("quoteParaSwap: calls /prices restricted to swapExactAmountIn, then /transactions, validates tokens and amount", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchFn: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body });
      if (url.includes("/prices")) return { ok: true, status: 200, json: async () => ({ priceRoute: { destAmount: "303", blockNumber: 5, bestRoute: [{ swaps: [{ swapExchanges: [{ exchange: "tessera" }, { exchange: "UniswapV3" }] }] }, { swaps: [{ swapExchanges: [{ exchange: "tessera" }] }] }] } }) };
      return { ok: true, status: 200, json: async () => ({ data: calldata }) };
    };
    const q = await quoteParaSwap(fetchFn, { chainId: 1, vault: VAULT, tokenIn: USDC, tokenOut: WETH, decimalsIn: 6, decimalsOut: 18, amountIn: BigInt(1_000_000_000), slippageBps: 100 });
    expect(q.expectedOut).toBe(BigInt(303));
    expect(q.minOut).toBe(BigInt(300));
    expect(q.exchanges).toEqual(["tessera", "UniswapV3"]);
    expect(calls[0]?.url).not.toContain("excludeDEXS");
    expect(calls[0]?.url).toContain("includeContractMethods=swapExactAmountIn");
    expect(calls[0]?.url).toContain("network=1");
    expect(calls[0]?.url).toContain("version=6.2");
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ userAddress: VAULT, receiver: VAULT, slippage: 100, srcAmount: "1000000000" });
    await expect(
      quoteParaSwap(fetchFn, { chainId: 1, vault: VAULT, tokenIn: USDC, tokenOut: DAI, decimalsIn: 6, decimalsOut: 18, amountIn: BigInt(1_000_000_000), slippageBps: 100 }),
    ).rejects.toThrow(/different tokens/);
    await expect(
      quoteParaSwap(fetchFn, { chainId: 1, vault: VAULT, tokenIn: USDC, tokenOut: WETH, decimalsIn: 6, decimalsOut: 18, amountIn: BigInt(5), slippageBps: 100 }),
    ).rejects.toThrow(/different input amount/);
  });
  it("quoteParaSwap can exclude liquidity sources", async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return url.includes("/prices") ? { ok: true, status: 200, json: async () => ({ priceRoute: { destAmount: "303" } }) } : { ok: true, status: 200, json: async () => ({ data: calldata }) };
    };
    await quoteParaSwap(fetchFn, { chainId: 8453, vault: VAULT, tokenIn: USDC, tokenOut: WETH, decimalsIn: 6, decimalsOut: 18, amountIn: BigInt(1_000_000_000), slippageBps: 100, excludeDexes: ["tessera", "foo"] });
    expect(decodeURIComponent(urls[0]!)).toContain("excludeDEXS=tessera,foo");
  });
  it("quoteParaSwap surfaces API errors", async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 400, json: async () => ({ error: "No routes found" }) });
    await expect(
      quoteParaSwap(fetchFn, { chainId: 1, vault: VAULT, tokenIn: USDC, tokenOut: WETH, decimalsIn: 6, decimalsOut: 18, amountIn: BigInt(1), slippageBps: 100 }),
    ).rejects.toThrow(/No routes found/);
  });
});

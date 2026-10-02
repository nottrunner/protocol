import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, getAddress, type Log } from "viem";
import { describe, expect, it } from "vitest";
import { comptrollerAbi } from "./abis";
import { encodeBuyShares, encodeRedeem, expectedShares, minSharesWithSlippage, parseBought, parseRedeemed } from "./calls";
import { previewInKindRedemption } from "./portfolio";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const COMP = "0x2222222222222222222222222222222222222222" as const;
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const E18 = BigInt(10) ** BigInt(18);

const asLog = (l: object) => l as unknown as Log;

describe("deposit maths (mirrors ComptrollerLib.__buyShares)", () => {
  it("first deposit into an empty 6-decimals vault: price = 1 unit (1e6), so 1000 USDC mints 1000e18 shares", () => {
    const price = BigInt(10) ** BigInt(6);
    expect(expectedShares(BigInt(1000) * price, price)).toBe(BigInt(1000) * E18);
  });
  it("later deposit at 1.25 USDC/share", () => {
    const price = BigInt(1_250_000);
    expect(expectedShares(BigInt(100_000_000), price)).toBe(BigInt(80) * E18);
  });
  it("zero / negative price yields 0 (caller must not send)", () => {
    expect(expectedShares(BigInt(5), BigInt(0))).toBe(BigInt(0));
  });
  it("minSharesWithSlippage applies bps and never returns 0 (the contract requires _minSharesQuantity > 0)", () => {
    expect(minSharesWithSlippage(BigInt(10_000), 100)).toBe(BigInt(9_900));
    expect(minSharesWithSlippage(BigInt(10_000), 0)).toBe(BigInt(10_000));
    expect(minSharesWithSlippage(BigInt(0), 100)).toBe(BigInt(1));
    expect(minSharesWithSlippage(BigInt(1), 9_999)).toBe(BigInt(1));
  });
  it("rejects invalid slippage", () => {
    expect(() => minSharesWithSlippage(BigInt(1), -1)).toThrow();
    expect(() => minSharesWithSlippage(BigInt(1), 10_001)).toThrow();
    expect(() => minSharesWithSlippage(BigInt(1), 1.5)).toThrow();
  });
  it("buyShares calldata round-trips", () => {
    const d = decodeFunctionData({ abi: comptrollerAbi, data: encodeBuyShares(BigInt(123), BigInt(7)) });
    expect(d.functionName).toBe("buyShares");
    expect(d.args).toEqual([BigInt(123), BigInt(7)]);
  });
});

describe("redeem encoding", () => {
  it("in kind: no additional assets, no skips", () => {
    const d = decodeFunctionData({ abi: comptrollerAbi, data: encodeRedeem({ mode: "inKind", recipient: A, shares: E18 }) });
    expect(d.functionName).toBe("redeemSharesInKind");
    expect(d.args).toEqual([A, E18, [], []]);
  });
  it("specific assets: percentages in bps, must total 10000 on-chain", () => {
    const d = decodeFunctionData({
      abi: comptrollerAbi, data: encodeRedeem({ mode: "specific", recipient: A, shares: E18, assets: [USDC], percentagesBps: [10_000] }),
    });
    expect(d.functionName).toBe("redeemSharesForSpecificAssets");
    expect(d.args).toEqual([A, E18, [USDC], [BigInt(10_000)]]);
  });
  it("specific assets: unequal arrays rejected", () => {
    expect(() => encodeRedeem({ mode: "specific", recipient: A, shares: E18, assets: [USDC, WETH], percentagesBps: [10_000] })).toThrow();
  });
});

describe("event parsing", () => {
  it("SharesBought", () => {
    const topics = encodeEventTopics({ abi: comptrollerAbi, eventName: "SharesBought", args: { buyer: A } });
    const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [BigInt(1), BigInt(2), BigInt(3)]);
    const log = asLog({ address: COMP, topics, data });
    expect(parseBought([log], COMP)).toEqual({ buyer: getAddress(A), investment: BigInt(1), sharesIssued: BigInt(2), sharesReceived: BigInt(3) });
    expect(parseBought([log], "0x3333333333333333333333333333333333333333")).toBeUndefined();
  });
  it("SharesRedeemed", () => {
    const topics = encodeEventTopics({ abi: comptrollerAbi, eventName: "SharesRedeemed", args: { redeemer: A, recipient: A } });
    const data = encodeAbiParameters(
      [{ type: "uint256" }, { type: "address[]" }, { type: "uint256[]" }],
      [E18, [USDC, WETH], [BigInt(5), BigInt(6)]],
    );
    const r = parseRedeemed([asLog({ address: COMP, topics, data })], COMP);
    expect(r?.shares).toBe(E18);
    expect(r?.assets).toEqual([USDC, WETH]);
    expect(r?.amounts).toEqual([BigInt(5), BigInt(6)]);
  });
});

describe("previewInKindRedemption", () => {
  const h = (symbol: string, balance: bigint, decimals = 18) => ({ address: USDC, symbol, decimals, balance });
  it("is pro rata of each balance with floor rounding", () => {
    const p = previewInKindRedemption([h("A", BigInt(1000)), h("B", BigInt(7))], BigInt(1), BigInt(3));
    expect(p.map((x) => x.amount)).toEqual([BigInt(333), BigInt(2)]);
  });
  it("empty supply => nothing", () => {
    expect(previewInKindRedemption([h("A", BigInt(1))], BigInt(1), BigInt(0))).toEqual([]);
  });
});

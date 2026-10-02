import { describe, expect, it } from "vitest";
import { hyperEvmChain, robinhoodChain, supportedChains } from "./chains";
import { featureFlags, isFeatureEnabled } from "./features";
import { tokensFor } from "./tokens";
import { getFundDeployer } from "../lib/contracts/addresses";

describe("chain + feature config", () => {
  it("supports exactly the five target chains", () => {
    expect(supportedChains.map((c) => c.id)).toEqual([1, 8453, 42161, 4663, 999]);
  });
  it("defines Robinhood Chain with verified values", () => {
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.nativeCurrency.symbol).toBe("ETH");
    expect(robinhoodChain.blockExplorers.default.url).toBe("https://robinhoodchain.blockscout.com");
  });
  it("defines HyperEVM with verified values", () => {
    expect(hyperEvmChain.id).toBe(999);
    expect(hyperEvmChain.name).toBe("HyperEVM");
    expect(hyperEvmChain.nativeCurrency).toEqual({ name: "HYPE", symbol: "HYPE", decimals: 18 });
    expect(hyperEvmChain.blockExplorers.default.url).toBe("https://hyperevmscan.io");
    expect(hyperEvmChain.rpcUrls.default.http[0]).toBe("https://rpc.hyperliquid.xyz/evm");
  });
  it("HyperEVM: create/deposit/redeem on, swap off (phase 1)", () => {
    expect(isFeatureEnabled(999, "create")).toBe(true);
    expect(isFeatureEnabled(999, "deposit")).toBe(true);
    expect(isFeatureEnabled(999, "redeem")).toBe(true);
    expect(isFeatureEnabled(999, "swap")).toBe(false);
  });
  it("HyperEVM knows USDC (Circle-native, 6 dec) and Wrapped HYPE", () => {
    const t = tokensFor(999);
    expect(t.find((x) => x.symbol === "USDC")).toMatchObject({ address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", decimals: 6 });
    expect(t.find((x) => x.symbol === "WHYPE")).toMatchObject({ address: "0x5555555555555555555555555555555555555555", decimals: 18 });
  });
  it("HyperEVM has a FundDeployer slot (null until deployed)", () => {
    expect(getFundDeployer(999)).toBeNull();
  });
  it("has flags for every chain", () => {
    for (const c of supportedChains) expect(featureFlags[c.id]).toBeDefined();
  });
  it("Robinhood Chain: create/deposit/redeem on, swap off", () => {
    expect(isFeatureEnabled(4663, "create")).toBe(true);
    expect(isFeatureEnabled(4663, "deposit")).toBe(true);
    expect(isFeatureEnabled(4663, "redeem")).toBe(true);
    expect(isFeatureEnabled(4663, "swap")).toBe(false);
  });
  it("unknown chains have everything disabled", () => {
    expect(isFeatureEnabled(998, "create")).toBe(false); // HyperEVM testnet is not supported
    expect(isFeatureEnabled(undefined, "create")).toBe(false);
  });
});

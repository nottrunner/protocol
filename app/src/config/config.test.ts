import { describe, expect, it } from "vitest";
import { robinhoodChain, supportedChains } from "./chains";
import { featureFlags, isFeatureEnabled } from "./features";

describe("chain + feature config", () => {
  it("supports exactly the four target chains", () => {
    expect(supportedChains.map((c) => c.id)).toEqual([1, 8453, 42161, 4663]);
  });
  it("defines Robinhood Chain with verified values", () => {
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.nativeCurrency.symbol).toBe("ETH");
    expect(robinhoodChain.blockExplorers.default.url).toBe("https://robinhoodchain.blockscout.com");
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
    expect(isFeatureEnabled(999, "create")).toBe(false);
    expect(isFeatureEnabled(undefined, "create")).toBe(false);
  });
});

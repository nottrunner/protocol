import { describe, expect, it } from "vitest";
import { getFundDeployer } from "./addresses";

describe("contract addresses", () => {
  it("returns null (not an invented address) when no record or env override is configured", () => {
    for (const id of [1, 8453, 42161, 4663]) expect(getFundDeployer(id)).toBeNull();
    expect(getFundDeployer(999)).toBeNull();
  });
});

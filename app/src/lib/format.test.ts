import { describe, expect, it } from "vitest";
import { formatAmount, safeParseUnits, shortAddress } from "./format";

describe("format helpers", () => {
  it("parses valid decimal amounts", () => {
    expect(safeParseUnits("1.5", 6)).toBe(BigInt(1_500_000));
    expect(safeParseUnits("10", 18)).toBe(BigInt(10) * BigInt(10) ** BigInt(18));
  });
  it("rejects invalid or over-precise input", () => {
    expect(safeParseUnits("", 6)).toBeUndefined();
    expect(safeParseUnits("abc", 6)).toBeUndefined();
    expect(safeParseUnits("1.1234567", 6)).toBeUndefined();
    expect(safeParseUnits("-1", 6)).toBeUndefined();
  });
  it("formats amounts", () => {
    expect(formatAmount(BigInt(1_500_000), 6)).toBe("1.5");
    expect(formatAmount(undefined, 6)).toBe("-");
  });
  it("shortens addresses", () => {
    expect(shortAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")).toBe("0x5fc5…d168");
  });
});

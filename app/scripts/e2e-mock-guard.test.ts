import { describe, expect, it, vi } from "vitest";
import { assertMockWalletAllowed, checkMockWalletEnv, parseMockWalletFlag } from "./e2e-mock-guard.mjs";

describe("parseMockWalletFlag", () => {
  it("is on only for exactly 1 / true", () => {
    expect(parseMockWalletFlag("1")).toBe("on");
    expect(parseMockWalletFlag("true")).toBe("on");
  });
  it("is off for unset, blank, 0, false", () => {
    for (const v of [undefined, "", "0", "false"]) expect(parseMockWalletFlag(v)).toBe("off");
  });
  it("treats anything else as invalid (never silently on or off)", () => {
    for (const v of ["yes", "TRUE", " 1", "1 ", "2", "on"]) expect(parseMockWalletFlag(v)).toBe("invalid");
  });
});

describe("checkMockWalletEnv", () => {
  const F = "NEXT_PUBLIC_E2E_MOCK_WALLET";
  it("fails when the flag is on and VERCEL_ENV=production", () => {
    for (const v of ["1", "true"]) {
      const r = checkMockWalletEnv({ [F]: v, VERCEL_ENV: "production", NODE_ENV: "production" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("VERCEL_ENV=production");
    }
  });
  it("fails when the flag is on and VERCEL_TARGET_ENV=production", () => {
    expect(checkMockWalletEnv({ [F]: "1", VERCEL_TARGET_ENV: "production" }).ok).toBe(false);
  });
  it("fails on an invalid flag value anywhere", () => {
    expect(checkMockWalletEnv({ [F]: "yes" }).ok).toBe(false);
    expect(checkMockWalletEnv({ [F]: "yes", VERCEL_ENV: "preview" }).ok).toBe(false);
  });
  it("allows the flag on Vercel preview / development and outside Vercel (QA builds), with a warning", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}, { NODE_ENV: "production" }]) {
      const r = checkMockWalletEnv({ [F]: "1", ...env });
      expect(r).toMatchObject({ ok: true, enabled: true });
      expect(r.ok && r.warnings.length).toBe(1);
    }
  });
  it("allows production builds without the flag (or with it explicitly off)", () => {
    for (const v of [undefined, "", "0", "false"]) {
      expect(checkMockWalletEnv({ [F]: v, VERCEL_ENV: "production", NODE_ENV: "production" })).toEqual({
        ok: true,
        enabled: false,
        warnings: [],
      });
    }
  });
});

describe("assertMockWalletAllowed", () => {
  it("throws for a production build with the flag and logs a warning otherwise", () => {
    expect(() => assertMockWalletAllowed({ NEXT_PUBLIC_E2E_MOCK_WALLET: "1", VERCEL_ENV: "production" })).toThrow(
      /never ship to production/,
    );
    const log = vi.fn();
    expect(assertMockWalletAllowed({ NEXT_PUBLIC_E2E_MOCK_WALLET: "1", VERCEL_ENV: "preview" }, log)).toBe(true);
    expect(log).toHaveBeenCalledOnce();
    expect(assertMockWalletAllowed({}, log)).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import { assertForkDeploymentsAllowed, checkForkDeploymentsEnv, parseForkDeploymentsFlag } from "./fork-deployments-guard.mjs";

const F = "NEXT_PUBLIC_USE_FORK_DEPLOYMENTS";

describe("parseForkDeploymentsFlag", () => {
  it("is on only for exactly 1 / true", () => {
    expect(parseForkDeploymentsFlag("1")).toBe("on");
    expect(parseForkDeploymentsFlag("true")).toBe("on");
  });
  it("is off for unset, blank, 0, false", () => {
    for (const v of [undefined, "", "0", "false"]) expect(parseForkDeploymentsFlag(v)).toBe("off");
  });
  it("treats anything else as invalid", () => {
    for (const v of ["yes", "TRUE", " 1", "2", "on"]) expect(parseForkDeploymentsFlag(v)).toBe("invalid");
  });
});

describe("checkForkDeploymentsEnv", () => {
  it("fails when on and VERCEL_ENV=production", () => {
    for (const v of ["1", "true"]) {
      const r = checkForkDeploymentsEnv({ [F]: v, VERCEL_ENV: "production", NODE_ENV: "production" });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toContain("VERCEL_ENV=production");
    }
  });
  it("fails when on and VERCEL_TARGET_ENV=production", () => {
    expect(checkForkDeploymentsEnv({ [F]: "1", VERCEL_TARGET_ENV: "production" }).ok).toBe(false);
  });
  it("fails on an invalid value anywhere", () => {
    expect(checkForkDeploymentsEnv({ [F]: "yes" }).ok).toBe(false);
    expect(checkForkDeploymentsEnv({ [F]: "yes", VERCEL_ENV: "preview" }).ok).toBe(false);
  });
  it("allows on in preview / development / local builds, with a warning", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}, { VERCEL_TARGET_ENV: "staging" }]) {
      const r = checkForkDeploymentsEnv({ [F]: "1", ...env });
      expect(r.ok).toBe(true);
      expect(r.ok && r.enabled).toBe(true);
      expect(r.ok && r.warnings.length).toBe(1);
    }
  });
  it("allows off / unset in production (env overrides are a separate, explicit opt-in)", () => {
    for (const v of [undefined, "", "0", "false"]) {
      const r = checkForkDeploymentsEnv({ [F]: v, VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" });
      expect(r.ok).toBe(true);
      expect(r.ok && r.enabled).toBe(false);
    }
  });
  it("does not care about the mock-wallet flag", () => {
    expect(checkForkDeploymentsEnv({ NEXT_PUBLIC_E2E_MOCK_WALLET: "1", VERCEL_ENV: "production" }).ok).toBe(true);
  });
});

describe("assertForkDeploymentsAllowed", () => {
  it("throws for production + flag, returns enabled otherwise, logs the warning", () => {
    expect(() => assertForkDeploymentsAllowed({ [F]: "1", VERCEL_ENV: "production" })).toThrow(/production/);
    const log = vi.fn();
    expect(assertForkDeploymentsAllowed({ [F]: "1" }, log)).toBe(true);
    expect(log).toHaveBeenCalledOnce();
    expect(assertForkDeploymentsAllowed({}, log)).toBe(false);
  });
});

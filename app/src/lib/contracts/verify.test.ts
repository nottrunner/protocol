import type { Config } from "wagmi";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FD = "0x1111111111111111111111111111111111111111";
const OTHER_FD = "0x2222222222222222222222222222222222222222";
const DISPATCHER = "0x3333333333333333333333333333333333333333";
const VAULT = "0x4444444444444444444444444444444444444444";
const COMPTROLLER = "0x5555555555555555555555555555555555555555";
const EVIL = "0x6666666666666666666666666666666666666666";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ZERO = "0x0000000000000000000000000000000000000000";
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const state = vi.hoisted(() => ({
  deployment: { fundDeployer: null as string | null, addresses: {} as Record<string, string> },
  reads: new Map<string, unknown>(),
  calls: [] as { fn: string; address: string; args?: unknown[] }[],
  writes: [] as { fn: string; address: string; args?: unknown[] }[],
}));

vi.mock("./addresses", () => ({ getChainDeployment: () => state.deployment }));
vi.mock("wagmi/actions", () => ({
  readContract: async (_c: unknown, p: { functionName: string; address: string; args?: unknown[] }) => {
    state.calls.push({ fn: p.functionName, address: p.address, args: p.args });
    const v = state.reads.get(p.functionName);
    if (v instanceof Error) throw v;
    if (v === undefined) throw new Error(`unmocked read ${p.functionName}`);
    return v;
  },
  simulateContract: async () => {
    throw new Error("STOP_AFTER_APPROVE");
  },
  writeContract: async (_c: unknown, p: { functionName: string; address: string; args?: unknown[] }) => {
    state.writes.push({ fn: p.functionName, address: p.address, args: p.args });
    return "0xabc";
  },
  waitForTransactionReceipt: async () => ({ status: "success", logs: [] }),
}));

import { depositFlow, redeemFlow } from "./flows";
import { evaluateVaultVerification, assertVerifiedVault, savedVaultStatus, UnverifiedVaultError, verifyVault } from "./verify";
import { swapFlow, type PreparedSwap } from "./swap";

const config = {} as Config;
const setup = (o: { fundDeployer?: string | null; dispatcher?: string | null; fdOfVault?: unknown; accessor?: unknown; vaultOfComptroller?: unknown } = {}) => {
  state.deployment = { fundDeployer: o.fundDeployer === undefined ? FD : o.fundDeployer, addresses: o.dispatcher === null ? {} : { dispatcher: o.dispatcher ?? DISPATCHER } };
  state.reads = new Map<string, unknown>([
    ["getFundDeployerForVaultProxy", o.fdOfVault === undefined ? FD : o.fdOfVault],
    ["getAccessor", o.accessor ?? COMPTROLLER],
    ["getVaultProxy", o.vaultOfComptroller ?? VAULT],
    ["allowance", BigInt(0)],
  ]);
  state.calls = [];
  state.writes = [];
};

describe("evaluateVaultVerification (pure; every branch but an exact match is unverified)", () => {
  const base = { configuredFundDeployer: FD, dispatcher: DISPATCHER };
  it("matching FundDeployer (case-insensitive) -> verified", () => {
    expect(evaluateVaultVerification({ ...base, reportedFundDeployer: FD.toUpperCase().replace("0X", "0x") }).status).toBe("verified");
  });
  it("mismatching FundDeployer -> unverified (mismatch)", () => {
    expect(evaluateVaultVerification({ ...base, reportedFundDeployer: OTHER_FD })).toMatchObject({ status: "unverified", reason: "mismatch" });
  });
  it("zero address -> unverified (zero-address)", () => {
    expect(evaluateVaultVerification({ ...base, reportedFundDeployer: ZERO })).toMatchObject({ status: "unverified", reason: "zero-address" });
  });
  it("revert / RPC error / timeout -> unverified (dispatcher-error), even if a value is also present", () => {
    expect(evaluateVaultVerification({ ...base, error: new Error("execution reverted") })).toMatchObject({ status: "unverified", reason: "dispatcher-error" });
    expect(evaluateVaultVerification({ ...base, error: "timeout", reportedFundDeployer: FD })).toMatchObject({ status: "unverified", reason: "dispatcher-error" });
  });
  it("garbage / missing answer -> unverified", () => {
    for (const r of [undefined, null, 5, "0x1234", "not an address", {}]) {
      expect(evaluateVaultVerification({ ...base, reportedFundDeployer: r }).status).toBe("unverified");
    }
  });
  it("no FundDeployer configured -> unverified (no-fund-deployer), regardless of the Dispatcher answer", () => {
    for (const fd of [null, undefined, "", ZERO, "junk"]) {
      expect(evaluateVaultVerification({ configuredFundDeployer: fd, dispatcher: DISPATCHER, reportedFundDeployer: FD })).toMatchObject({ status: "unverified", reason: "no-fund-deployer" });
    }
  });
  it("no Dispatcher -> unverified (no-dispatcher)", () => {
    for (const d of [null, undefined, ZERO]) {
      expect(evaluateVaultVerification({ configuredFundDeployer: FD, dispatcher: d, reportedFundDeployer: FD })).toMatchObject({ status: "unverified", reason: "no-dispatcher" });
    }
  });
  it("invalid vault address -> unverified", () => {
    expect(evaluateVaultVerification({ ...base, vaultValid: false, reportedFundDeployer: FD })).toMatchObject({ status: "unverified", reason: "invalid-vault" });
  });
});

describe("verifyVault (reads the Dispatcher; never throws; fails closed)", () => {
  beforeEach(() => setup());
  it("Dispatcher reports the configured FundDeployer -> verified", async () => {
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toEqual({ status: "verified", fundDeployer: FD });
    expect(state.calls.find((c) => c.fn === "getFundDeployerForVaultProxy")).toMatchObject({ address: DISPATCHER, args: [VAULT] });
  });
  it("FundDeployer mismatch -> unverified", async () => {
    setup({ fdOfVault: OTHER_FD });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "mismatch" });
  });
  it("Dispatcher returns the zero address -> unverified", async () => {
    setup({ fdOfVault: ZERO });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "zero-address" });
  });
  it("Dispatcher call reverts -> unverified, does not throw", async () => {
    setup({ fdOfVault: new Error("execution reverted") });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "dispatcher-error" });
  });
  it("RPC failure / timeout while reading -> unverified, does not throw", async () => {
    setup({ fdOfVault: new Error("The request timed out.") });
    await expect(verifyVault(config, { chainId: 1, vault: VAULT })).resolves.toMatchObject({ status: "unverified", reason: "dispatcher-error" });
  });
  it("non-address return value -> unverified", async () => {
    setup({ fdOfVault: "0x1234" });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT })).toMatchObject({ status: "unverified", reason: "dispatcher-error" });
  });
  it("no FundDeployer configured -> unverified without any RPC call", async () => {
    setup({ fundDeployer: null });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "no-fund-deployer" });
    expect(state.calls).toHaveLength(0);
  });
  it("Dispatcher absent from the record: taken from the configured FundDeployer; if that fails -> unverified", async () => {
    setup({ dispatcher: null });
    state.reads.set("getDispatcher", DISPATCHER);
    expect(await verifyVault(config, { chainId: 1, vault: VAULT })).toMatchObject({ status: "verified" });
    expect(state.calls.find((c) => c.fn === "getDispatcher")?.address).toBe(FD);
    state.reads.set("getDispatcher", new Error("reverted"));
    expect(await verifyVault(config, { chainId: 1, vault: VAULT })).toMatchObject({ status: "unverified", reason: "no-dispatcher" });
  });
  it("vault and comptroller must point at each other", async () => {
    setup({ accessor: EVIL });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "comptroller-mismatch" });
    setup({ vaultOfComptroller: EVIL });
    expect(await verifyVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).toMatchObject({ status: "unverified", reason: "comptroller-mismatch" });
  });
  it("invalid address -> unverified", async () => {
    expect(await verifyVault(config, { chainId: 1, vault: "0xnope" })).toMatchObject({ status: "unverified", reason: "invalid-vault" });
  });
  it("assertVerifiedVault throws UnverifiedVaultError unless verified", async () => {
    await expect(assertVerifiedVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).resolves.toBeUndefined();
    setup({ fdOfVault: ZERO });
    await expect(assertVerifiedVault(config, { chainId: 1, vault: VAULT, comptroller: COMPTROLLER })).rejects.toBeInstanceOf(UnverifiedVaultError);
  });
});

const prepared = {
  route: { kind: "uniswapV3", address: EVIL, quoter: null, label: "x" }, selector: "0x00000000", integrationData: "0x", tokenIn: USDC, tokenOut: USDC,
  amountIn: BigInt(1), expectedOut: BigInt(1), minOut: BigInt(1), description: "",
} as unknown as PreparedSwap;
const deposit = () => depositFlow(config, { chainId: 1, account: ACCOUNT, vault: VAULT, comptroller: COMPTROLLER, denominationAsset: USDC, amount: BigInt(100), slippageBps: 100 });
const redeem = () =>
  redeemFlow(config, { chainId: 1, account: ACCOUNT, vault: VAULT, comptroller: COMPTROLLER, redemption: { mode: "inKind", recipient: ACCOUNT, shares: BigInt(1) } });
const swap = () => swapFlow(config, { chainId: 1, account: ACCOUNT, vault: VAULT, comptroller: COMPTROLLER, prepared });

describe("no approval / transaction path is reachable for an unverified vault", () => {
  const cases: [string, Parameters<typeof setup>[0]][] = [
    ["no FundDeployer configured", { fundDeployer: null }],
    ["FundDeployer mismatch", { fdOfVault: OTHER_FD }],
    ["Dispatcher returns zero", { fdOfVault: ZERO }],
    ["Dispatcher call reverts", { fdOfVault: new Error("execution reverted") }],
    ["comptroller does not belong to the vault", { vaultOfComptroller: EVIL }],
  ];
  for (const [name, o] of cases) {
    it(`${name}: deposit, redeem and swap reject before any write; no approve`, async () => {
      setup(o);
      for (const run of [deposit, redeem, swap]) await expect(run()).rejects.toBeInstanceOf(UnverifiedVaultError);
      expect(state.writes).toHaveLength(0);
      expect(state.calls.some((c) => c.fn === "allowance")).toBe(false);
    });
  }
  it("verified vault: the approval targets the vault's comptroller and nothing else", async () => {
    setup();
    await expect(deposit()).rejects.toThrow("STOP_AFTER_APPROVE");
    expect(state.writes).toEqual([{ fn: "approve", address: USDC, args: [COMPTROLLER, BigInt(100)] }]);
  });
});

describe("savedVaultStatus (My portfolios annotation for vaults saved by earlier versions; fails closed)", () => {
  it("pending check => checking; only a verified result => verified", () => {
    expect(savedVaultStatus(undefined)).toBe("checking");
    expect(savedVaultStatus({ status: "verified", fundDeployer: FD })).toBe("verified");
  });
  it("mismatch, zero address, revert/RPC error, no FundDeployer, and a failed query are all unverified", () => {
    for (const reason of ["mismatch", "zero-address", "dispatcher-error", "no-fund-deployer", "no-dispatcher", "invalid-vault", "comptroller-mismatch"] as const) {
      expect(savedVaultStatus({ status: "unverified", reason })).toBe("unverified");
    }
    expect(savedVaultStatus(undefined, true)).toBe("unverified");
    expect(savedVaultStatus({ status: "verified", fundDeployer: FD }, true)).toBe("unverified");
  });
});

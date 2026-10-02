import { afterEach, describe, expect, it, vi } from "vitest";
import { arbitrumChain, baseChain, ethereumChain, hyperEvmChain, robinhoodChain } from "./chains";
import { DEFAULT_RPC_URLS, RPC_ENV_VARS, readRpcEnv, resolveRpcUrl, resolveRpcUrls } from "./rpc";

const LOCAL = "http://127.0.0.1:8545";

describe("resolveRpcUrl", () => {
  it("uses the default when unset", () => {
    expect(resolveRpcUrl("ethereum", undefined)).toBe("https://ethereum-rpc.publicnode.com");
    expect(resolveRpcUrl("base", undefined)).toBe("https://mainnet.base.org");
    expect(resolveRpcUrl("robinhood", undefined)).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(resolveRpcUrl("arbitrum", undefined)).toBe("https://arb1.arbitrum.io/rpc");
    expect(resolveRpcUrl("hyperevm", undefined)).toBe("https://rpc.hyperliquid.xyz/evm");
  });
  it("uses the env override when set", () => {
    expect(resolveRpcUrl("ethereum", LOCAL)).toBe(LOCAL);
    expect(resolveRpcUrl("robinhood", "https://rpc.example.com/key")).toBe("https://rpc.example.com/key");
  });
  it("treats an empty string as unset", () => {
    expect(resolveRpcUrl("base", "")).toBe(DEFAULT_RPC_URLS.base);
  });
  it("treats a whitespace-only string as unset", () => {
    expect(resolveRpcUrl("arbitrum", "   ")).toBe(DEFAULT_RPC_URLS.arbitrum);
  });
  it("trims surrounding whitespace on an override", () => {
    expect(resolveRpcUrl("base", `  ${LOCAL}\n`)).toBe(LOCAL);
  });
  it("rejects malformed or non-http(s) overrides, naming the env var", () => {
    expect(() => resolveRpcUrl("base", "not a url")).toThrow(RPC_ENV_VARS.base);
    expect(() => resolveRpcUrl("ethereum", "ftp://example.com")).toThrow(/http\(s\)/);
  });
});

describe("resolveRpcUrls", () => {
  it("returns all defaults for an empty env", () => {
    expect(resolveRpcUrls({})).toEqual(DEFAULT_RPC_URLS);
    expect(resolveRpcUrls()).toEqual(DEFAULT_RPC_URLS);
  });
  it("overrides chains independently", () => {
    expect(resolveRpcUrls({ ethereum: LOCAL, base: "" })).toEqual({ ...DEFAULT_RPC_URLS, ethereum: LOCAL });
  });
  it("can point every chain at one local fork", () => {
    const all = resolveRpcUrls({ ethereum: LOCAL, base: LOCAL, robinhood: LOCAL, arbitrum: LOCAL, hyperevm: LOCAL });
    expect(Object.values(all)).toEqual([LOCAL, LOCAL, LOCAL, LOCAL, LOCAL]);
  });
});

describe("env var names", () => {
  it("are the documented public vars", () => {
    expect(RPC_ENV_VARS).toEqual({
      ethereum: "NEXT_PUBLIC_RPC_URL_ETHEREUM",
      base: "NEXT_PUBLIC_RPC_URL_BASE",
      robinhood: "NEXT_PUBLIC_RPC_URL_ROBINHOOD",
      arbitrum: "NEXT_PUBLIC_RPC_URL_ARBITRUM",
      hyperevm: "NEXT_PUBLIC_RPC_URL_HYPEREVM",
    });
  });
});

describe("chain definitions", () => {
  it("use the resolved default endpoints when no env is set", () => {
    // The test env sets no NEXT_PUBLIC_RPC_URL_* vars.
    expect(ethereumChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.ethereum);
    expect(baseChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.base);
    expect(arbitrumChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.arbitrum);
    expect(robinhoodChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.robinhood);
    expect(robinhoodChain.id).toBe(4663);
    expect(hyperEvmChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.hyperevm);
    expect(hyperEvmChain.id).toBe(999);
  });
});

describe("process.env wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("readRpcEnv reads the five public vars", () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_ETHEREUM", LOCAL);
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_BASE", "");
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_HYPEREVM", "http://127.0.0.1:8646");
    expect(readRpcEnv()).toMatchObject({ ethereum: LOCAL, base: "", hyperevm: "http://127.0.0.1:8646" });
  });

  it("chain definitions pick up env overrides and ignore empty values", async () => {
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_ETHEREUM", LOCAL);
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_ROBINHOOD", "http://127.0.0.1:8546");
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_HYPEREVM", "http://127.0.0.1:8646");
    vi.stubEnv("NEXT_PUBLIC_RPC_URL_BASE", "");
    vi.resetModules();
    const chains = await import("./chains");
    expect(chains.ethereumChain.rpcUrls.default.http[0]).toBe(LOCAL);
    expect(chains.robinhoodChain.rpcUrls.default.http[0]).toBe("http://127.0.0.1:8546");
    expect(chains.hyperEvmChain.rpcUrls.default.http[0]).toBe("http://127.0.0.1:8646");
    expect(chains.baseChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.base);
    expect(chains.arbitrumChain.rpcUrls.default.http[0]).toBe(DEFAULT_RPC_URLS.arbitrum);
  });
});

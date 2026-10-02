/**
 * Per-chain RPC endpoint resolution.
 *
 * Each chain's endpoint is configurable with a public env var and falls back to a public default when the
 * var is unset, empty, or whitespace-only. This lets a QA build point at a local Anvil fork
 * (e.g. NEXT_PUBLIC_RPC_URL_ETHEREUM=http://127.0.0.1:8545) without code changes.
 *
 * Keep this module free of side effects and of `process.env` reads other than `readRpcEnv`, so the
 * resolver stays unit-testable.
 */

export const RPC_CHAIN_KEYS = ["ethereum", "base", "robinhood", "arbitrum", "hyperevm"] as const;
export type RpcChainKey = (typeof RPC_CHAIN_KEYS)[number];

/** Env var that overrides the RPC endpoint of each chain. */
export const RPC_ENV_VARS = {
  ethereum: "NEXT_PUBLIC_RPC_URL_ETHEREUM",
  base: "NEXT_PUBLIC_RPC_URL_BASE",
  robinhood: "NEXT_PUBLIC_RPC_URL_ROBINHOOD",
  arbitrum: "NEXT_PUBLIC_RPC_URL_ARBITRUM",
  hyperevm: "NEXT_PUBLIC_RPC_URL_HYPEREVM",
} as const satisfies Record<RpcChainKey, string>;

/**
 * Public default endpoints (rate-limited; use a dedicated provider in production).
 * Each was checked with `eth_chainId` on 2026-10-01.
 */
export const DEFAULT_RPC_URLS = {
  ethereum: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  robinhood: "https://rpc.mainnet.chain.robinhood.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  // Read-only public endpoint of the Hyperliquid docs; rate-limited, no websocket (eth_chainId = 0x3e7 checked 2026-10-02).
  hyperevm: "https://rpc.hyperliquid.xyz/evm",
} as const satisfies Record<RpcChainKey, string>;

export type RpcUrls = Record<RpcChainKey, string>;
export type RpcEnv = Partial<Record<RpcChainKey, string | undefined>>;

/**
 * Resolve one endpoint: a non-blank override wins, otherwise the default. Overrides are trimmed and must be
 * http(s) URLs; anything else throws so a typo fails loudly instead of silently breaking every RPC call.
 */
export function resolveRpcUrl(chain: RpcChainKey, override: string | undefined): string {
  const value = override?.trim();
  if (!value) return DEFAULT_RPC_URLS[chain];
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error(`${RPC_ENV_VARS[chain]} is not a valid URL: "${value}"`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${RPC_ENV_VARS[chain]} must be an http(s) URL, got "${value}"`);
  }
  return value;
}

/** Resolve all endpoints from a map of raw override values (keyed by chain). */
export function resolveRpcUrls(env: RpcEnv = {}): RpcUrls {
  return {
    ethereum: resolveRpcUrl("ethereum", env.ethereum),
    base: resolveRpcUrl("base", env.base),
    robinhood: resolveRpcUrl("robinhood", env.robinhood),
    arbitrum: resolveRpcUrl("arbitrum", env.arbitrum),
    hyperevm: resolveRpcUrl("hyperevm", env.hyperevm),
  };
}

/**
 * Read the overrides from the build/runtime environment. NEXT_PUBLIC_* vars must be referenced statically
 * (no `process.env[name]`) or Next.js will not inline them into the browser bundle.
 */
export function readRpcEnv(): RpcEnv {
  return {
    ethereum: process.env.NEXT_PUBLIC_RPC_URL_ETHEREUM,
    base: process.env.NEXT_PUBLIC_RPC_URL_BASE,
    robinhood: process.env.NEXT_PUBLIC_RPC_URL_ROBINHOOD,
    arbitrum: process.env.NEXT_PUBLIC_RPC_URL_ARBITRUM,
    hyperevm: process.env.NEXT_PUBLIC_RPC_URL_HYPEREVM,
  };
}

/** Resolved endpoints for the current environment. */
export const rpcUrls: RpcUrls = resolveRpcUrls(readRpcEnv());

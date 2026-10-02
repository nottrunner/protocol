// Build-time guard for the E2E mock wallet (test-only). Pure logic so it can be unit-tested; see
// check-e2e-mock-guard.mjs (CLI, run by `prebuild`) and next.config.mjs (re-checks after .env files load).

export const MOCK_WALLET_FLAG = "NEXT_PUBLIC_E2E_MOCK_WALLET";

/**
 * Parse the build flag. Exactly "1" or "true" => "on" (these are the only values src/config/wagmi.ts treats as on,
 * so the guard and the app can never disagree); unset / "" / "0" / "false" => "off"; anything else (" 1", "TRUE",
 * "yes", ...) => "invalid" and fails the build, so a typo can neither silently enable nor silently hide the wallet.
 * @param {string | undefined} raw
 * @returns {"on" | "off" | "invalid"}
 */
export function parseMockWalletFlag(raw) {
  const v = raw ?? "";
  if (v === "" || v === "0" || v === "false") return "off";
  if (v === "1" || v === "true") return "on";
  return "invalid";
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, enabled: boolean, warnings: string[] } | { ok: false, enabled: boolean, error: string }}
 */
export function checkMockWalletEnv(env) {
  const flag = parseMockWalletFlag(env[MOCK_WALLET_FLAG]);
  if (flag === "invalid") {
    return {
      ok: false,
      enabled: false,
      error: `${MOCK_WALLET_FLAG} must be "1", "true", "0", "false" or unset, got "${env[MOCK_WALLET_FLAG]}".`,
    };
  }
  const enabled = flag === "on";
  // Vercel sets VERCEL_ENV to production | preview | development (custom environments report "preview" there and
  // their slug in VERCEL_TARGET_ENV; "production" shows up in both for the Production environment). NODE_ENV is
  // "production" for every `next build`, so on its own it says nothing about the deployment target.
  const isVercelProduction = env.VERCEL_ENV === "production" || env.VERCEL_TARGET_ENV === "production";
  if (enabled && isVercelProduction) {
    return {
      ok: false,
      enabled,
      error:
        `${MOCK_WALLET_FLAG}=${env[MOCK_WALLET_FLAG]} is set for a Vercel production build (VERCEL_ENV=production). ` +
        "The E2E mock wallet signs with a PUBLIC Anvil key and must never ship to production. " +
        `Remove ${MOCK_WALLET_FLAG} from the Production environment in Vercel.`,
    };
  }
  /** @type {string[]} */
  const warnings = [];
  if (enabled) {
    warnings.push(`${MOCK_WALLET_FLAG} is on: this build contains the E2E mock wallet (test-only, public Anvil key).`);
  }
  return { ok: true, enabled, warnings };
}

/** Throws if the environment is not allowed to build; returns whether the mock wallet is enabled. */
export function assertMockWalletAllowed(env, log = console.warn) {
  const result = checkMockWalletEnv(env);
  if (!result.ok) throw new Error(result.error);
  for (const w of result.warnings) log(`[e2e-mock-wallet] ${w}`);
  return result.enabled;
}

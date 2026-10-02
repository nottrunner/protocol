// Build-time guard for fork deployment records (test-only). Pure logic so it can be unit-tested; see
// check-fork-deployments-guard.mjs (CLI, run by `prebuild`) and next.config.mjs (re-checks after .env files load).
// Same shape as e2e-mock-guard.mjs. Fork records describe addresses that exist only on a throwaway local fork; shipping
// them in a public build would point real chain ids at nonexistent contracts.

export const FORK_DEPLOYMENTS_FLAG = "NEXT_PUBLIC_USE_FORK_DEPLOYMENTS";

/**
 * Exactly "1" or "true" => "on"; unset / "" / "0" / "false" => "off"; anything else => "invalid" (fails the build, so a
 * typo can neither silently enable nor silently hide fork records).
 * @param {string | undefined} raw
 * @returns {"on" | "off" | "invalid"}
 */
export function parseForkDeploymentsFlag(raw) {
  const v = raw ?? "";
  if (v === "" || v === "0" || v === "false") return "off";
  if (v === "1" || v === "true") return "on";
  return "invalid";
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, enabled: boolean, warnings: string[] } | { ok: false, enabled: boolean, error: string }}
 */
export function checkForkDeploymentsEnv(env) {
  const flag = parseForkDeploymentsFlag(env[FORK_DEPLOYMENTS_FLAG]);
  if (flag === "invalid") {
    return {
      ok: false,
      enabled: false,
      error: `${FORK_DEPLOYMENTS_FLAG} must be "1", "true", "0", "false" or unset, got "${env[FORK_DEPLOYMENTS_FLAG]}".`,
    };
  }
  const enabled = flag === "on";
  // Same production detection as the mock-wallet guard (Vercel sets both for the Production environment).
  const isVercelProduction = env.VERCEL_ENV === "production" || env.VERCEL_TARGET_ENV === "production";
  if (enabled && isVercelProduction) {
    return {
      ok: false,
      enabled,
      error:
        `${FORK_DEPLOYMENTS_FLAG}=${env[FORK_DEPLOYMENTS_FLAG]} is set for a Vercel production build (VERCEL_ENV=production). ` +
        "Fork deployment records point real chain ids at addresses that only exist on a local fork. " +
        `Remove ${FORK_DEPLOYMENTS_FLAG} from the Production environment in Vercel.`,
    };
  }
  /** @type {string[]} */
  const warnings = [];
  if (enabled) {
    warnings.push(
      `${FORK_DEPLOYMENTS_FLAG} is on: this build embeds FORK deployment records (addresses exist only on a local fork; test-only).`,
    );
  }
  return { ok: true, enabled, warnings };
}

/** Throws if the environment is not allowed to build; returns whether fork records are enabled. */
export function assertForkDeploymentsAllowed(env, log = console.warn) {
  const result = checkForkDeploymentsEnv(env);
  if (!result.ok) throw new Error(result.error);
  for (const w of result.warnings) log(`[fork-deployments] ${w}`);
  return result.enabled;
}

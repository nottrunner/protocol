export const FORK_DEPLOYMENTS_FLAG: "NEXT_PUBLIC_USE_FORK_DEPLOYMENTS";
export function parseForkDeploymentsFlag(raw: string | undefined): "on" | "off" | "invalid";
export function checkForkDeploymentsEnv(
  env: Record<string, string | undefined>,
): { ok: true; enabled: boolean; warnings: string[] } | { ok: false; enabled: boolean; error: string };
export function assertForkDeploymentsAllowed(env: Record<string, string | undefined>, log?: (msg: string) => void): boolean;

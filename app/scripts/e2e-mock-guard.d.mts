export const MOCK_WALLET_FLAG: "NEXT_PUBLIC_E2E_MOCK_WALLET";
export function parseMockWalletFlag(raw: string | undefined): "on" | "off" | "invalid";
export function checkMockWalletEnv(
  env: Record<string, string | undefined>,
): { ok: true; enabled: boolean; warnings: string[] } | { ok: false; enabled: boolean; error: string };
export function assertMockWalletAllowed(env: Record<string, string | undefined>, log?: (msg: string) => void): boolean;

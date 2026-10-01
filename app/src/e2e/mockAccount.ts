import { isHex, type Hex } from "viem";
import { mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * TEST-ONLY. Anvil's well-known PUBLIC mnemonic (documented by Foundry/Hardhat) and its account #0 key.
 * Anything sent to these addresses on a real chain is stolen within seconds. This module is only reachable
 * when NEXT_PUBLIC_E2E_MOCK_WALLET=1 and is compiled out of every other build (see src/config/wagmi.ts).
 *
 * `qa/fixtures.json` (branch feat/deploy-scripts) lists the Anvil accounts by index (addresses only, no keys);
 * index N here is account N there (derivation m/44'/60'/0'/0/N). src/e2e/mockAccount.test.ts pins that mapping.
 */
export const ANVIL_TEST_MNEMONIC = "test test test test test test test test test test test junk";
/** Anvil account #0 private key (public, test-only). */
export const ANVIL_ACCOUNT_0_PRIVATE_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export type MockAccountEnv = { index?: string | undefined; privateKey?: string | undefined };

/**
 * Pick the signing account: an explicit private key wins, else Anvil account `index` (default 0).
 * Blank values count as unset. Malformed values throw, naming the env var.
 */
export function resolveMockAccount(env: MockAccountEnv = {}): PrivateKeyAccount {
  const key = env.privateKey?.trim();
  if (key) {
    if (!isHex(key, { strict: true }) || key.length !== 66) {
      throw new Error("NEXT_PUBLIC_E2E_MOCK_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string.");
    }
    return privateKeyToAccount(key);
  }
  const rawIndex = env.index?.trim();
  if (!rawIndex) return privateKeyToAccount(ANVIL_ACCOUNT_0_PRIVATE_KEY);
  if (!/^\d+$/.test(rawIndex) || Number(rawIndex) > 9) {
    throw new Error(`NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX must be an integer 0-9 (Anvil default accounts), got "${rawIndex}".`);
  }
  const account = mnemonicToAccount(ANVIL_TEST_MNEMONIC, { addressIndex: Number(rawIndex) });
  // Return a plain private-key account so callers always get the same shape.
  return privateKeyToAccount(toHex(account.getHdKey().privateKey));
}

function toHex(bytes: Uint8Array | null): Hex {
  if (!bytes) throw new Error("could not derive private key");
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Read the build-time env. NEXT_PUBLIC_* must be referenced statically so Next.js inlines them. */
export function readMockAccountEnv(): MockAccountEnv {
  return {
    index: process.env.NEXT_PUBLIC_E2E_MOCK_ACCOUNT_INDEX,
    privateKey: process.env.NEXT_PUBLIC_E2E_MOCK_PRIVATE_KEY,
  };
}

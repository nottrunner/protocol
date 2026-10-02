// Fails (exit 1) if the E2E mock wallet flag is set for a Vercel production build. Run by `prebuild` and CI.
import { assertMockWalletAllowed } from "./e2e-mock-guard.mjs";

try {
  assertMockWalletAllowed(process.env);
} catch (err) {
  console.error(`\n[e2e-mock-wallet] BUILD BLOCKED: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}

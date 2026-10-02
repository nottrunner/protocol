// Fails (exit 1) if fork deployment records are enabled for a Vercel production build. Run by `prebuild` and CI.
import { assertForkDeploymentsAllowed } from "./fork-deployments-guard.mjs";

try {
  assertForkDeploymentsAllowed(process.env);
} catch (err) {
  console.error(`\n[fork-deployments] BUILD BLOCKED: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}

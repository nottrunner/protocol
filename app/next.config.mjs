import { resolve } from "node:path";
import { assertMockWalletAllowed } from "./scripts/e2e-mock-guard.mjs";
import { assertForkDeploymentsAllowed } from "./scripts/fork-deployments-guard.mjs";
import { loadRecordsFromDir } from "./scripts/load-deployment-records.mjs";

// Second line of defence behind the `prebuild` script (which does not see .env* files, and is skipped when
// `next build` is invoked directly): next.config runs after Next has loaded .env* into process.env.
if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
  assertMockWalletAllowed(process.env, () => {});
  assertForkDeploymentsAllowed(process.env, () => {});
}

// Deployment records (deployments/<chain>.json, written by script/DeployCore.s.sol) are read HERE, at build time, and
// inlined as NEXT_PUBLIC_DEPLOYMENT_RECORDS. Fork / unlabelled records are dropped unless NEXT_PUBLIC_USE_FORK_DEPLOYMENTS
// is 1/true, so fork-only addresses are absent from a default bundle (checked by `npm run verify:fork-bundle`).
// DEPLOYMENTS_DIR (build-time only, not exposed) overrides the directory; default is the repo's ../deployments.
const useForkDeployments = process.env.NEXT_PUBLIC_USE_FORK_DEPLOYMENTS === "1" || process.env.NEXT_PUBLIC_USE_FORK_DEPLOYMENTS === "true";
const deploymentsDir = resolve(process.env.DEPLOYMENTS_DIR || "../deployments");
const { records: deploymentRecords } = loadRecordsFromDir(deploymentsDir, {
  useFork: useForkDeployments,
  warn: (m) => console.warn(`[deployments] ${m}`),
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Always define the flag (empty when unset). Next only inlines NEXT_PUBLIC_* vars that exist, so without this an
  // unset flag stays a runtime `process.env` lookup and webpack cannot drop the guarded E2E mock wallet branch in
  // src/config/wagmi.ts. Defined-as-"" makes the branch statically false => connector + test key compiled out.
  env: {
    NEXT_PUBLIC_E2E_MOCK_WALLET: process.env.NEXT_PUBLIC_E2E_MOCK_WALLET ?? "",
    // Same reasoning for the fork flag: always defined so the fork branches fold statically.
    NEXT_PUBLIC_USE_FORK_DEPLOYMENTS: process.env.NEXT_PUBLIC_USE_FORK_DEPLOYMENTS ?? "",
    NEXT_PUBLIC_DEPLOYMENT_RECORDS: JSON.stringify(deploymentRecords),
  },
  webpack: (config) => {
    // Optional peer deps of wallet SDKs that are not needed in the browser bundle.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @coinbase/cdp-sdk (pulled in by wagmi's baseAccount connector) imports optional x402 peers
    // that are not installed and never used by this app; stub them so the bundle resolves.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    return config;
  },
};

export default nextConfig;

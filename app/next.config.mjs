import { assertMockWalletAllowed } from "./scripts/e2e-mock-guard.mjs";

// Second line of defence behind the `prebuild` script (which does not see .env* files, and is skipped when
// `next build` is invoked directly): next.config runs after Next has loaded .env* into process.env.
if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV) {
  assertMockWalletAllowed(process.env, () => {});
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Always define the flag (empty when unset). Next only inlines NEXT_PUBLIC_* vars that exist, so without this an
  // unset flag stays a runtime `process.env` lookup and webpack cannot drop the guarded E2E mock wallet branch in
  // src/config/wagmi.ts. Defined-as-"" makes the branch statically false => connector + test key compiled out.
  env: { NEXT_PUBLIC_E2E_MOCK_WALLET: process.env.NEXT_PUBLIC_E2E_MOCK_WALLET ?? "" },
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

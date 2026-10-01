/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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

import type { ChainEnvOverrides } from "./types";

/**
 * Per-chain NEXT_PUBLIC_* overrides. Every access is a literal `process.env.NEXT_PUBLIC_X` on purpose: Next.js only
 * inlines literal references (a dynamic `process.env[name]` is empty in the browser bundle). Keep the
 * names in sync with .env.example and README.
 */
export const envOverridesByChain: Record<number, ChainEnvOverrides> = {
  1: {
    fundDeployer: process.env.NEXT_PUBLIC_FUND_DEPLOYER_ETHEREUM,
    valueInterpreter: process.env.NEXT_PUBLIC_VALUE_INTERPRETER_ETHEREUM,
    fundValueCalculatorRouter: process.env.NEXT_PUBLIC_FUND_VALUE_CALCULATOR_ROUTER_ETHEREUM,
    deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK_ETHEREUM,
    denominationAssets: process.env.NEXT_PUBLIC_DENOMINATION_ASSETS_ETHEREUM,
    uniswapV3Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_ADAPTER_ETHEREUM,
    uniswapV3SwapRouter02Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_SWAPROUTER02_ADAPTER_ETHEREUM,
    uniswapV3Quoter: process.env.NEXT_PUBLIC_UNISWAP_V3_QUOTER_ETHEREUM,
    paraSwapV6Adapter: process.env.NEXT_PUBLIC_PARASWAP_V6_ADAPTER_ETHEREUM,
  },
  8453: {
    fundDeployer: process.env.NEXT_PUBLIC_FUND_DEPLOYER_BASE,
    valueInterpreter: process.env.NEXT_PUBLIC_VALUE_INTERPRETER_BASE,
    fundValueCalculatorRouter: process.env.NEXT_PUBLIC_FUND_VALUE_CALCULATOR_ROUTER_BASE,
    deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK_BASE,
    denominationAssets: process.env.NEXT_PUBLIC_DENOMINATION_ASSETS_BASE,
    uniswapV3Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_ADAPTER_BASE,
    uniswapV3SwapRouter02Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_SWAPROUTER02_ADAPTER_BASE,
    uniswapV3Quoter: process.env.NEXT_PUBLIC_UNISWAP_V3_QUOTER_BASE,
    paraSwapV6Adapter: process.env.NEXT_PUBLIC_PARASWAP_V6_ADAPTER_BASE,
  },
  42161: {
    fundDeployer: process.env.NEXT_PUBLIC_FUND_DEPLOYER_ARBITRUM,
    valueInterpreter: process.env.NEXT_PUBLIC_VALUE_INTERPRETER_ARBITRUM,
    fundValueCalculatorRouter: process.env.NEXT_PUBLIC_FUND_VALUE_CALCULATOR_ROUTER_ARBITRUM,
    deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK_ARBITRUM,
    denominationAssets: process.env.NEXT_PUBLIC_DENOMINATION_ASSETS_ARBITRUM,
    uniswapV3Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_ADAPTER_ARBITRUM,
    uniswapV3SwapRouter02Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_SWAPROUTER02_ADAPTER_ARBITRUM,
    uniswapV3Quoter: process.env.NEXT_PUBLIC_UNISWAP_V3_QUOTER_ARBITRUM,
    paraSwapV6Adapter: process.env.NEXT_PUBLIC_PARASWAP_V6_ADAPTER_ARBITRUM,
  },
  4663: {
    fundDeployer: process.env.NEXT_PUBLIC_FUND_DEPLOYER_ROBINHOOD,
    valueInterpreter: process.env.NEXT_PUBLIC_VALUE_INTERPRETER_ROBINHOOD,
    fundValueCalculatorRouter: process.env.NEXT_PUBLIC_FUND_VALUE_CALCULATOR_ROUTER_ROBINHOOD,
    deployBlock: process.env.NEXT_PUBLIC_DEPLOY_BLOCK_ROBINHOOD,
    denominationAssets: process.env.NEXT_PUBLIC_DENOMINATION_ASSETS_ROBINHOOD,
    uniswapV3Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_ADAPTER_ROBINHOOD,
    uniswapV3SwapRouter02Adapter: process.env.NEXT_PUBLIC_UNISWAP_V3_SWAPROUTER02_ADAPTER_ROBINHOOD,
    uniswapV3Quoter: process.env.NEXT_PUBLIC_UNISWAP_V3_QUOTER_ROBINHOOD,
    paraSwapV6Adapter: process.env.NEXT_PUBLIC_PARASWAP_V6_ADAPTER_ROBINHOOD,
  },
};

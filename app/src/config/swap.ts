import type { Address } from "viem";

/**
 * Uniswap V3 QuoterV2 per chain, used for off-chain (eth_call) swap quotes. Official addresses from
 * https://docs.uniswap.org/contracts/v3/reference/deployments (Ethereum, Arbitrum One, Base); each one was checked for
 * code on its chain on 2026-10-02. Overridable via the deployment record (`externalContracts.uniswapV3QuoterV2`) or
 * NEXT_PUBLIC_UNISWAP_V3_QUOTER_<CHAIN>. Robinhood Chain: none (swaps off in phase 1).
 */
export const knownUniswapV3Quoters: Record<number, Address> = {
  1: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  42161: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  8453: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

import { supportedChainIds } from "@/config/chains";
import { envOverridesByChain } from "./env";
import { parseInlinedRecords, resolveAllDeployments } from "./loader";
import type { ChainDeployment } from "./types";

export * from "./types";
export { parseDenominationAssetsEnv, parseInlinedRecords, resolveChainDeployment, resolveSwapAdapters } from "./loader";
export type { LoaderInput } from "./loader";

/**
 * `NEXT_PUBLIC_DEPLOYMENT_RECORDS` is produced by next.config.mjs from deployments/*.json (or $DEPLOYMENTS_DIR) and only
 * contains records that may ship: "mainnet" ones, plus fork/unlabelled ones iff NEXT_PUBLIC_USE_FORK_DEPLOYMENTS=1.
 * Both vars are literal `process.env.X` accesses so Next inlines them.
 */
const useFork = process.env.NEXT_PUBLIC_USE_FORK_DEPLOYMENTS === "1" || process.env.NEXT_PUBLIC_USE_FORK_DEPLOYMENTS === "true";
const records = parseInlinedRecords(process.env.NEXT_PUBLIC_DEPLOYMENT_RECORDS);

export const deployments: Record<number, ChainDeployment> = resolveAllDeployments(supportedChainIds, {
  records,
  useFork,
  env: envOverridesByChain,
});

const NONE = (chainId: number): ChainDeployment => ({
  chainId, origin: "none", recordSource: null, isFork: false, addresses: {}, fundDeployer: null, denominationAssets: [],
  denominationSource: "fallback", fromBlock: null, fromBlockSource: null, adapters: {}, quoter: null, swapAdapters: [], swapAdapter: null, approvedAdaptersListId: null,
  notes: [],
});

export function getDeployment(chainId: number): ChainDeployment {
  return deployments[chainId] ?? NONE(chainId);
}

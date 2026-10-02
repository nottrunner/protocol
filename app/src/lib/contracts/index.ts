export { getFundDeployer, getProtocolAddresses, protocolAddresses } from "./addresses";
export type { ProtocolAddresses } from "./addresses";
export {
  listPortfolios,
  useCreatePortfolio,
  useDeposit,
  useRedeem,
  useTokenBalance,
  useVault,
} from "./hooks";
export type { CreatePortfolioInput, CreatePortfolioResult } from "./hooks";

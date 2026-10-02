import type { Address } from "viem";

/** Keys of `addresses` in deployments/<chain>.json (written by script/DeployCore.s.sol). All optional for the app. */
export type ProtocolAddressKey =
  | "addressListRegistry" | "comptrollerLib" | "dispatcher" | "externalPositionFactory" | "externalPositionManager"
  | "feeManager" | "fundDeployer" | "fundValueCalculator" | "fundValueCalculatorRouter" | "gasRelayPaymasterFactory"
  | "globalConfigProxy" | "integrationManager" | "policyManager" | "protocolFeeReserveProxy" | "protocolFeeTracker"
  | "uintListRegistry" | "valueInterpreter" | "vaultLib"
  // adapters (written by the register-adapters deploy step; absent until then)
  | "uniswapV3Adapter" | "uniswapV3SwapRouter02Adapter" | "paraSwapV6Adapter";

export type ProtocolAddressMap = Partial<Record<ProtocolAddressKey, Address>>;

export type DenominationAsset = { symbol: string; address: Address };

/** Where the record came from. Only "mainnet" records are used by default; see scripts/deployment-records.mjs. */
export type RecordSource = "mainnet" | "fork" | "unlabelled";

/** Swap adapters recognised by the app. `uniswapV3` = original SwapRouter (Ethereum, Arbitrum);
 *  `uniswapV3SwapRouter02` = the PR #4 variant for routers without `deadline` (Base). */
export type SwapAdapterKind = "uniswapV3" | "uniswapV3SwapRouter02";

export type SwapAdapter = { kind: SwapAdapterKind; address: Address; quoter: Address | null };

export type FromBlockSource = "env" | "deployBlock" | "forkBlock" | "blockNumberAtDeploy";

export type ChainDeployment = {
  chainId: number;
  /** Where the addresses come from. "env" = NEXT_PUBLIC_*_<CHAIN> overrides only (record absent, ignored or superseded). */
  origin: "record" | "env" | "none";
  recordSource: RecordSource | null;
  /** True when the addresses come from a fork / unlabelled record: they exist only on a local fork. */
  isFork: boolean;
  addresses: ProtocolAddressMap;
  fundDeployer: Address | null;
  /** Allowed denomination assets. `record`/`env`: the form is restricted to this list; `fallback`: verified quick-picks from
   *  src/config/tokens.ts (the form also accepts a pasted address; the chain's ValueInterpreter is the final check). */
  denominationAssets: DenominationAsset[];
  denominationSource: "record" | "env" | "fallback";
  /** Block to start NewFundCreated log scans from (null = unknown; callers use a bounded look-back). */
  fromBlock: bigint | null;
  fromBlockSource: FromBlockSource | null;
  /** Adapter addresses present in the record / env (not yet filtered for per-chain eligibility). */
  adapters: Partial<Record<SwapAdapterKind, Address>>;
  quoter: Address | null;
  /** The adapter the swap UI may use on this chain, or null (=> "Swaps not enabled on this chain"). */
  swapAdapter: SwapAdapter | null;
  /** Human-readable notes/warnings (ignored records, superseded record, bad values). */
  notes: string[];
};

/** Raw env overrides for one chain (all optional strings, as read from process.env). */
export type ChainEnvOverrides = {
  fundDeployer?: string;
  valueInterpreter?: string;
  fundValueCalculatorRouter?: string;
  deployBlock?: string;
  denominationAssets?: string;
  uniswapV3Adapter?: string;
  uniswapV3SwapRouter02Adapter?: string;
  uniswapV3Quoter?: string;
};

import { parseAbi } from "viem";

// Minimal ABIs, derived from contracts/release/** and contracts/persistent/** in this repo (Enzyme v4 fork).
// Functions that Enzyme declares non-view because price-feed reads may touch third-party state (calcGav, calcNav, ...)
// are `nonpayable` here and must be called with eth_call (simulateContract), never sent as transactions.

export const fundDeployerAbi = parseAbi([
  "function createNewFund(address _fundOwner, string _fundName, string _fundSymbol, address _denominationAsset, uint256 _sharesActionTimelock, bytes _feeManagerConfigData, bytes _policyManagerConfigData) returns (address comptrollerProxy_, address vaultProxy_)",
  "function getComptrollerLib() view returns (address)",
  "function releaseIsLive() view returns (bool)",
  "event NewFundCreated(address indexed creator, address vaultProxy, address comptrollerProxy)",
]);

export const comptrollerAbi = parseAbi([
  "function getDenominationAsset() view returns (address)",
  "function getVaultProxy() view returns (address)",
  "function getValueInterpreter() view returns (address)",
  "function getIntegrationManager() view returns (address)",
  "function getWethToken() view returns (address)",
  "function getSharesActionTimelock() view returns (uint256)",
  "function getLastSharesBoughtTimestampForAccount(address _who) view returns (uint256)",
  "function calcGav() returns (uint256 gav_)",
  "function calcGrossShareValue() returns (uint256 grossShareValue_)",
  "function buyShares(uint256 _investmentAmount, uint256 _minSharesQuantity) returns (uint256 sharesReceived_)",
  "function redeemSharesInKind(address _recipient, uint256 _sharesQuantity, address[] _additionalAssets, address[] _assetsToSkip) returns (address[] payoutAssets_, uint256[] payoutAmounts_)",
  "function redeemSharesForSpecificAssets(address _recipient, uint256 _sharesQuantity, address[] _payoutAssets, uint256[] _payoutAssetPercentages) returns (uint256[] payoutAmounts_)",
  "function callOnExtension(address _extension, uint256 _actionId, bytes _callArgs)",
  "event SharesBought(address indexed buyer, uint256 investmentAmount, uint256 sharesIssued, uint256 sharesReceived)",
  "event SharesRedeemed(address indexed redeemer, address indexed recipient, uint256 sharesAmount, address[] receivedAssets, uint256[] receivedAssetAmounts)",
]);

export const valueInterpreterAbi = parseAbi([
  "function isSupportedPrimitiveAsset(address _asset) view returns (bool)",
  "function isSupportedAsset(address _asset) view returns (bool)",
  "function calcCanonicalAssetValue(address _baseAsset, uint256 _amount, address _quoteAsset) returns (uint256 value_)",
]);

/** FundValueCalculatorRouter (persistent). All calc* are non-view: call with eth_call. */
export const fundValueCalculatorRouterAbi = parseAbi([
  "function calcGav(address _vaultProxy) returns (address denominationAsset_, uint256 gav_)",
  "function calcNav(address _vaultProxy) returns (address denominationAsset_, uint256 nav_)",
  "function calcNetShareValue(address _vaultProxy) returns (address denominationAsset_, uint256 netShareValue_)",
  "function calcNetValueForSharesHolder(address _vaultProxy, address _sharesHolder) returns (address denominationAsset_, uint256 netValue_)",
]);

export const vaultAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function getOwner() view returns (address)",
  "function getAccessor() view returns (address)",
  "function getTrackedAssets() view returns (address[])",
  "function canManageAssets(address _who) view returns (bool)",
]);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Uniswap V3 QuoterV2: not a view fn (it reverts internally to read results), so use eth_call / simulateContract. */
export const quoterV2Abi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export const integrationManagerAbi = parseAbi([
  "event CallOnIntegrationExecutedForFund(address indexed comptrollerProxy, address caller, address indexed adapter, bytes4 indexed selector, bytes integrationData, address[] incomingAssets, uint256[] incomingAssetAmounts, address[] spendAssets, uint256[] spendAssetAmounts)",
]);

/** ParaSwap (Velora) Augustus V6 generic exact-in entrypoint, used to decode the calldata the Velora API returns. */
export const augustusV6Abi = parseAbi([
  "function swapExactAmountIn(address executor, (address srcToken, address destToken, uint256 fromAmount, uint256 toAmount, uint256 quotedAmount, bytes32 metadata, address beneficiary) swapData, uint256 partnerAndFee, bytes permit, bytes executorData) payable returns (uint256 receivedAmount, uint256 paraswapShare, uint256 partnerShare)",
]);

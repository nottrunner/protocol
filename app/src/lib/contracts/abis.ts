import { parseAbi } from "viem";

// Minimal ABIs, derived from contracts/release/core/** and contracts/persistent/vault/** in this repo.

export const fundDeployerAbi = parseAbi([
  "function createNewFund(address _fundOwner, string _fundName, string _fundSymbol, address _denominationAsset, uint256 _sharesActionTimelock, bytes _feeManagerConfigData, bytes _policyManagerConfigData) returns (address comptrollerProxy_, address vaultProxy_)",
  "event NewFundCreated(address indexed creator, address vaultProxy, address comptrollerProxy)",
]);

export const comptrollerAbi = parseAbi([
  "function getDenominationAsset() view returns (address)",
  "function getVaultProxy() view returns (address)",
  "function buyShares(uint256 _investmentAmount, uint256 _minSharesQuantity) returns (uint256 sharesReceived_)",
  "function redeemSharesInKind(address _recipient, uint256 _sharesQuantity, address[] _additionalAssets, address[] _assetsToSkip) returns (address[] payoutAssets_, uint256[] payoutAmounts_)",
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
]);

export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

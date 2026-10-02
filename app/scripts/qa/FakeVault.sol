// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

/// QA-ONLY hostile fixture. Pretends to be BOTH a vault proxy and its comptroller (accessor = itself) with the given
/// denomination token, so the app can read a convincing "portfolio" from it. It was NOT created by the protocol's FundDeployer, so the
/// Dispatcher does not know it: the app must show it as unverified and never approve the token to it.
/// Deploy on a local fork only:  forge create FakeVault.sol:FakeVault --constructor-args <denominationToken> --rpc-url <anvil> --unlocked --from <acct>
contract FakeVault {
    address public immutable denomination;

    constructor(address _denomination) {
        denomination = _denomination;
    }

    // vault side
    function getAccessor() external view returns (address) { return address(this); }
    function name() external pure returns (string memory) { return "Totally Legit Fund"; }
    function symbol() external pure returns (string memory) { return "SCAM"; }
    function getOwner() external view returns (address) { return address(this); }
    function totalSupply() external pure returns (uint256) { return 0; }
    function balanceOf(address) external pure returns (uint256) { return 0; }
    function canManageAssets(address) external pure returns (bool) { return true; }
    function getLastSharesBoughtTimestampForAccount(address) external pure returns (uint256) { return 0; }
    function getTrackedAssets() external view returns (address[] memory a) { a = new address[](1); a[0] = denomination; }

    // comptroller side
    function getVaultProxy() external view returns (address) { return address(this); }
    function getDenominationAsset() external view returns (address) { return denomination; }
    function getSharesActionTimelock() external pure returns (uint256) { return 0; }
    function getValueInterpreter() external pure returns (address) { return address(0); }
    function getIntegrationManager() external pure returns (address) { return address(0); }
    function getWethToken() external pure returns (address) { return address(0); }
    function calcGrossShareValue() external pure returns (uint256) { return 1e6; }
    function buyShares(uint256, uint256) external pure returns (uint256) { return 1; }
}

// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {IAddressListRegistry} from "contracts/persistent/address-list-registry/IAddressListRegistry.sol";
import {
    IParaSwapV6Adapter as IParaSwapV6AdapterProd
} from "contracts/release/extensions/integration-manager/integrations/adapters/interfaces/IParaSwapV6Adapter.sol";

import {Test} from "forge-std/Test.sol";

import {DeployCore} from "script/DeployCore.s.sol";

import {CoreUtils} from "tests/utils/CoreUtils.sol";

import {IERC20} from "tests/interfaces/external/IERC20.sol";
import {IComptrollerLib} from "tests/interfaces/internal/IComptrollerLib.sol";
import {IFundDeployer} from "tests/interfaces/internal/IFundDeployer.sol";
import {IIntegrationManager} from "tests/interfaces/internal/IIntegrationManager.sol";
import {IParaSwapV6Adapter} from "tests/interfaces/internal/IParaSwapV6Adapter.sol";
import {IUniswapV3Adapter} from "tests/interfaces/internal/IUniswapV3Adapter.sol";
import {IVaultLib} from "tests/interfaces/internal/IVaultLib.sol";

import {ParaSwapRoute, paraSwapRouteArbitrum, paraSwapRouteBase, paraSwapRouteEthereum} from "./ParaSwapRoutes.sol";

/// @dev Runs `script/DeployCore.s.sol` (`deployAll`) on a pinned fork of a real chain and checks that the adapters it
/// deploys are bound to the freshly deployed IntegrationManager, listed in the approved-adapters list, and can
/// execute a real swap for a fund created through the freshly deployed FundDeployer.
abstract contract DeployCoreAdaptersTestBase is CoreUtils {
    DeployCore.Persistent internal persistent;
    DeployCore.Release internal release;
    DeployCore.Adapters internal adapters;

    IComptrollerLib internal comptrollerProxy;
    IVaultLib internal vaultProxy;
    address internal fundOwner;

    function __deployAndCreateFund(string memory _chain, string memory _rpcAlias, uint256 _forkBlock, address _usdc)
        internal
    {
        vm.createSelectFork({urlOrAlias: _rpcAlias, blockNumber: _forkBlock});

        DeployCore deployCore = new DeployCore();
        (persistent, release, adapters) = deployCore.deployAll(_chain);

        (comptrollerProxy, vaultProxy, fundOwner) = createFund({
            _fundDeployer: IFundDeployer(release.fundDeployer),
            _denominationAsset: IERC20(_usdc),
            _sharesActionTimelock: 0,
            _feeManagerConfigData: "",
            _policyManagerConfigData: ""
        });
    }

    // ASSERTIONS

    function __assertBoundAndListed(address _adapter) internal {
        assertTrue(_adapter != address(0), "adapter not deployed");
        assertTrue(_adapter.code.length > 0, "adapter has no code");
        assertEq(
            IIntegrationManagerAdapter(_adapter).getIntegrationManager(),
            release.integrationManager,
            "adapter bound to wrong IntegrationManager"
        );
        assertTrue(adapters.listCreated, "no approved adapters list");
        assertTrue(
            IAddressListRegistry(persistent.addressListRegistry).isInList(adapters.approvedAdaptersListId, _adapter),
            "adapter not in approved list"
        );
    }

    // ACTIONS

    function __uniswapSwap(address _adapter, address _weth, address _usdc, uint24 _fee, uint256 _amountIn) internal {
        increaseTokenBalance({_token: IERC20(_weth), _to: address(vaultProxy), _amount: _amountIn});
        uint256 preWeth = IERC20(_weth).balanceOf(address(vaultProxy));
        uint256 preUsdc = IERC20(_usdc).balanceOf(address(vaultProxy));

        uint24[] memory fees = new uint24[](1);
        fees[0] = _fee;

        vm.prank(fundOwner);
        callOnIntegration({
            _integrationManager: IIntegrationManager(release.integrationManager),
            _comptrollerProxy: comptrollerProxy,
            _adapter: _adapter,
            _selector: IUniswapV3Adapter.takeOrder.selector,
            _actionArgs: abi.encode(toArray(_weth, _usdc), fees, _amountIn, uint256(1))
        });

        assertEq(IERC20(_weth).balanceOf(address(vaultProxy)), preWeth - _amountIn, "WETH not spent");
        assertGt(IERC20(_usdc).balanceOf(address(vaultProxy)), preUsdc, "no USDC received");
    }

    function __paraSwapSwap(address _adapter, ParaSwapRoute memory _r) internal {
        increaseTokenBalance({_token: IERC20(_r.srcToken), _to: address(vaultProxy), _amount: _r.fromAmount});
        uint256 preSrc = IERC20(_r.srcToken).balanceOf(address(vaultProxy));
        uint256 preDest = IERC20(_r.destToken).balanceOf(address(vaultProxy));

        bytes memory swapArgs = abi.encode(
            IParaSwapV6AdapterProd.SwapActionArgs({
                executor: _r.executor,
                swapData: IParaSwapV6AdapterProd.SwapData({
                    srcToken: _r.srcToken,
                    destToken: _r.destToken,
                    fromAmount: _r.fromAmount,
                    toAmount: _r.toAmount,
                    quotedAmount: _r.quotedAmount,
                    metadata: _r.metadata
                }),
                partnerAndFee: _r.partnerAndFee,
                executorData: _r.executorData
            })
        );

        vm.prank(fundOwner);
        callOnIntegration({
            _integrationManager: IIntegrationManager(release.integrationManager),
            _comptrollerProxy: comptrollerProxy,
            _adapter: _adapter,
            _selector: IParaSwapV6Adapter.action.selector,
            _actionArgs: abi.encode(IParaSwapV6AdapterProd.Action.SwapExactAmountIn, swapArgs)
        });

        assertEq(IERC20(_r.srcToken).balanceOf(address(vaultProxy)), preSrc - _r.fromAmount, "src token not spent");
        assertGe(IERC20(_r.destToken).balanceOf(address(vaultProxy)), preDest + _r.toAmount, "less than min received");
        assertEq(IERC20(_r.srcToken).balanceOf(_adapter), 0, "adapter holds src token");
    }
}

interface IIntegrationManagerAdapter {
    function getIntegrationManager() external view returns (address);
}

contract DeployCoreAdaptersEthereumTest is DeployCoreAdaptersTestBase {
    function setUp() public {
        ParaSwapRoute memory r = paraSwapRouteEthereum();
        __deployAndCreateFund({_chain: "ethereum", _rpcAlias: "mainnet", _forkBlock: r.forkBlock, _usdc: r.destToken});
    }

    function test_adapters_deployedBoundAndListed() public {
        assertTrue(adapters.uniswapV3SwapRouter02Adapter == address(0), "SwapRouter02 adapter must not be on Ethereum");
        __assertBoundAndListed(adapters.uniswapV3Adapter);
        __assertBoundAndListed(adapters.paraSwapV6Adapter);
    }

    function test_swap_uniswapV3() public {
        ParaSwapRoute memory r = paraSwapRouteEthereum();
        __uniswapSwap({
            _adapter: adapters.uniswapV3Adapter,
            _weth: r.srcToken,
            _usdc: r.destToken,
            _fee: 3000,
            _amountIn: r.fromAmount
        });
    }

    function test_swap_paraSwapV6() public {
        __paraSwapSwap({_adapter: adapters.paraSwapV6Adapter, _r: paraSwapRouteEthereum()});
    }
}

contract DeployCoreAdaptersBaseTest is DeployCoreAdaptersTestBase {
    function setUp() public {
        ParaSwapRoute memory r = paraSwapRouteBase();
        __deployAndCreateFund({_chain: "base", _rpcAlias: "base", _forkBlock: r.forkBlock, _usdc: r.destToken});
    }

    function test_adapters_deployedBoundAndListed() public {
        // Base only has SwapRouter02 (no `deadline`), so the original-router UniswapV3Adapter must not be deployed
        assertTrue(adapters.uniswapV3Adapter == address(0), "original-router adapter must not be on Base");
        __assertBoundAndListed(adapters.uniswapV3SwapRouter02Adapter);
        __assertBoundAndListed(adapters.paraSwapV6Adapter);
    }

    function test_swap_uniswapV3SwapRouter02() public {
        ParaSwapRoute memory r = paraSwapRouteBase();
        __uniswapSwap({
            _adapter: adapters.uniswapV3SwapRouter02Adapter,
            _weth: r.srcToken,
            _usdc: r.destToken,
            _fee: 500,
            _amountIn: r.fromAmount
        });
    }

    function test_swap_paraSwapV6() public {
        __paraSwapSwap({_adapter: adapters.paraSwapV6Adapter, _r: paraSwapRouteBase()});
    }
}

contract DeployCoreAdaptersArbitrumTest is DeployCoreAdaptersTestBase {
    function setUp() public {
        ParaSwapRoute memory r = paraSwapRouteArbitrum();
        __deployAndCreateFund({_chain: "arbitrum", _rpcAlias: "arbitrum", _forkBlock: r.forkBlock, _usdc: r.destToken});
    }

    function test_adapters_deployedBoundAndListed() public {
        assertTrue(adapters.uniswapV3SwapRouter02Adapter == address(0), "SwapRouter02 adapter must not be on Arbitrum");
        __assertBoundAndListed(adapters.uniswapV3Adapter);
        __assertBoundAndListed(adapters.paraSwapV6Adapter);
    }

    function test_swap_uniswapV3() public {
        ParaSwapRoute memory r = paraSwapRouteArbitrum();
        __uniswapSwap({
            _adapter: adapters.uniswapV3Adapter,
            _weth: r.srcToken,
            _usdc: r.destToken,
            _fee: 3000,
            _amountIn: r.fromAmount
        });
    }

    function test_swap_paraSwapV6() public {
        __paraSwapSwap({_adapter: adapters.paraSwapV6Adapter, _r: paraSwapRouteArbitrum()});
    }
}

/// @dev No fork needed: Robinhood Chain stays Phase 1 (no swap adapters)
contract DeployCoreAdaptersConfigTest is Test {
    function test_robinhood_hasNoAdapters() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/chains/robinhood.json"));
        assertFalse(vm.parseJsonBool(json, ".features.swaps"));
        assertFalse(vm.parseJsonBool(json, ".features.uniswapV3Adapter"));
        assertFalse(vm.parseJsonBool(json, ".features.uniswapV3SwapRouter02Adapter"));
        assertFalse(vm.parseJsonBool(json, ".features.paraSwapV6Adapter"));
    }

    function test_swapChains_haveParaSwapAndOneUniswapVariant() public {
        string[3] memory chains = ["ethereum", "base", "arbitrum"];
        for (uint256 i; i < 3; i++) {
            string memory json = vm.readFile(string.concat(vm.projectRoot(), "/config/chains/", chains[i], ".json"));
            assertTrue(vm.parseJsonBool(json, ".features.paraSwapV6Adapter"), chains[i]);
            // exactly one Uniswap adapter variant per chain (original router vs SwapRouter02)
            assertTrue(
                vm.parseJsonBool(json, ".features.uniswapV3Adapter")
                    != vm.parseJsonBool(json, ".features.uniswapV3SwapRouter02Adapter"),
                chains[i]
            );
        }
    }
}

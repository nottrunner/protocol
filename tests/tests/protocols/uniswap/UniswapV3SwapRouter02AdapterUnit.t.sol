// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import {UnitTest} from "tests/bases/UnitTest.sol";

import {IERC20} from "tests/interfaces/external/IERC20.sol";
import {IUniswapV3SwapRouter} from "tests/interfaces/external/IUniswapV3SwapRouter.sol";

import {IUniswapV3Adapter} from "tests/interfaces/internal/IUniswapV3Adapter.sol";

/// @dev Pure unit test (no fork / RPC needed): a mock router records the calldata it receives
contract MockUniswapV3Router {
    bytes public lastCalldata;
    uint256 public callCount;

    receive() external payable {}

    fallback() external payable {
        lastCalldata = msg.data;
        callCount++;
        // exactInput() returns uint256 amountOut
        assembly {
            mstore(0, 0)
            return(0, 32)
        }
    }
}

/// @dev SwapRouter02's `exactInput()` params struct (no `deadline`), declared locally to derive its selector independently
interface IUniswapV3SwapRouter02Local {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata) external payable returns (uint256);
}

contract UniswapV3AdapterRouterAbiUnitTest is UnitTest {
    // Selectors verified on-chain: original SwapRouter (Ethereum/Arbitrum) vs. SwapRouter02 (Base/Robinhood Chain)
    bytes4 internal constant ORIGINAL_SWAP_ROUTER_EXACT_INPUT_SELECTOR = 0xc04b8d59;
    bytes4 internal constant SWAP_ROUTER_02_EXACT_INPUT_SELECTOR = 0xb858183f;

    MockUniswapV3Router internal router;
    address internal vault = makeAddr("vault");
    IERC20 internal tokenA;
    IERC20 internal tokenB;

    function setUp() public {
        router = new MockUniswapV3Router();
        tokenA = createTestToken("token A");
        tokenB = createTestToken("token B");
    }

    function __deployAdapter(string memory _artifact) private returns (IUniswapV3Adapter) {
        // This test contract stands in for the IntegrationManager, which is the only allowed caller of takeOrder()
        address addr = deployCode(_artifact, abi.encode(address(this), address(router)));
        return IUniswapV3Adapter(addr);
    }

    function __takeOrder(IUniswapV3Adapter _adapter, uint256 _amountIn, uint256 _minAmountOut) private {
        address[] memory pathAddresses = toArray(address(tokenA), address(tokenB));
        uint24[] memory pathFees = new uint24[](1);
        pathFees[0] = 3000;

        _adapter.takeOrder(vault, abi.encode(pathAddresses, pathFees, _amountIn, _minAmountOut), "");
    }

    function __encodedPath() private view returns (bytes memory) {
        return abi.encodePacked(address(tokenA), uint24(3000), address(tokenB));
    }

    function test_selectors() public {
        assertEq(IUniswapV3SwapRouter.exactInput.selector, ORIGINAL_SWAP_ROUTER_EXACT_INPUT_SELECTOR);
        assertEq(IUniswapV3SwapRouter02Local.exactInput.selector, SWAP_ROUTER_02_EXACT_INPUT_SELECTOR);
    }

    function test_originalAdapter_callsOriginalSwapRouterAbi() public {
        IUniswapV3Adapter adapter = __deployAdapter("UniswapV3Adapter.sol");

        uint256 amountIn = 123;
        uint256 minAmountOut = 45;
        __takeOrder(adapter, amountIn, minAmountOut);

        assertEq(router.callCount(), 1, "router not called once");

        bytes memory data = router.lastCalldata();
        assertEq(bytes4(data), ORIGINAL_SWAP_ROUTER_EXACT_INPUT_SELECTOR, "incorrect selector");

        bytes memory expected = abi.encodeWithSelector(
            IUniswapV3SwapRouter.exactInput.selector,
            IUniswapV3SwapRouter.ExactInputParams({
                path: __encodedPath(),
                recipient: vault,
                deadline: block.timestamp + 1,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            })
        );
        assertEq(data, expected, "incorrect calldata");
    }

    function test_swapRouter02Adapter_callsSwapRouter02Abi() public {
        IUniswapV3Adapter adapter = __deployAdapter("UniswapV3SwapRouter02Adapter.sol");

        uint256 amountIn = 123;
        uint256 minAmountOut = 45;
        __takeOrder(adapter, amountIn, minAmountOut);

        assertEq(router.callCount(), 1, "router not called once");

        bytes memory data = router.lastCalldata();
        assertEq(bytes4(data), SWAP_ROUTER_02_EXACT_INPUT_SELECTOR, "incorrect selector");

        bytes memory expected = abi.encodeWithSelector(
            IUniswapV3SwapRouter02Local.exactInput.selector,
            IUniswapV3SwapRouter02Local.ExactInputParams({
                path: __encodedPath(), recipient: vault, amountIn: amountIn, amountOutMinimum: minAmountOut
            })
        );
        assertEq(data, expected, "incorrect calldata");
    }

    function test_swapRouter02Adapter_sameParsingAsOriginal() public {
        IUniswapV3Adapter original = __deployAdapter("UniswapV3Adapter.sol");
        IUniswapV3Adapter variant = __deployAdapter("UniswapV3SwapRouter02Adapter.sol");

        assertEq(variant.getUniswapV3Router(), address(router));
        assertEq(original.getUniswapV3Router(), address(router));

        address[] memory pathAddresses = toArray(address(tokenA), address(tokenB));
        uint24[] memory pathFees = new uint24[](1);
        pathFees[0] = 3000;
        bytes memory actionData = abi.encode(pathAddresses, pathFees, uint256(7), uint256(3));

        bytes memory callData = abi.encodeWithSelector(
            original.parseAssetsForAction.selector, address(0), original.takeOrder.selector, actionData
        );
        (bool successA, bytes memory a) = address(original).staticcall(callData);
        (bool successB, bytes memory b) = address(variant).staticcall(callData);
        assertTrue(successA && successB, "parseAssetsForAction failed");
        assertEq(a, b, "parseAssetsForAction differs");
    }

    function test_takeOrder_failsIfNotIntegrationManager() public {
        IUniswapV3Adapter adapter = __deployAdapter("UniswapV3SwapRouter02Adapter.sol");

        vm.prank(makeAddr("not integration manager"));
        vm.expectRevert("Only the IntegrationManager can call this function");
        __takeOrder(adapter, 1, 1);
    }
}

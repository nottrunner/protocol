// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Enzyme Protocol.

    (c) Enzyme Foundation <security@enzyme.finance>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {IUniswapV3SwapRouter02} from "../../../../../external-interfaces/IUniswapV3SwapRouter02.sol";
import {UniswapV3Adapter} from "./UniswapV3Adapter.sol";

/// @title UniswapV3SwapRouter02Adapter Contract
/// @author Enzyme Foundation <security@enzyme.finance>
/// @notice Adapter for interacting with UniswapV3 swaps via SwapRouter02
/// @dev Identical to UniswapV3Adapter, except that `exactInput()` is called with the SwapRouter02 ABI
/// (no `deadline` in `ExactInputParams`). Use this variant on chains where only SwapRouter02 is deployed
/// (e.g., Base, Robinhood Chain). Use UniswapV3Adapter with the original SwapRouter (e.g., Ethereum, Arbitrum).
/// @dev DEADLINE WARNING: SwapRouter02's `exactInput()` has no `deadline` parameter, so this variant provides NO
/// deadline protection (the original adapter passes `block.timestamp + 1`, which is only a same-block guard in any case).
/// A swap included late is protected solely by `minIncomingAssetAmount` (slippage), so callers must set it tightly.
contract UniswapV3SwapRouter02Adapter is UniswapV3Adapter {
    constructor(address _integrationManager, address _router) public UniswapV3Adapter(_integrationManager, _router) {}

    /// @dev Calls `exactInput()` using the SwapRouter02 `ExactInputParams` struct (no `deadline`)
    function __uniswapV3ExactInput(
        address _router,
        bytes memory _encodedPath,
        address _recipient,
        uint256 _amountIn,
        uint256 _amountOutMinimum
    ) internal override {
        IUniswapV3SwapRouter02.ExactInputParams memory input = IUniswapV3SwapRouter02.ExactInputParams({
            path: _encodedPath, recipient: _recipient, amountIn: _amountIn, amountOutMinimum: _amountOutMinimum
        });

        IUniswapV3SwapRouter02(_router).exactInput(input);
    }
}

// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Enzyme Protocol.

    (c) Enzyme Foundation <security@enzyme.finance>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity >=0.6.0 <0.9.0;
pragma experimental ABIEncoderV2;

/// @title IUniswapV3SwapRouter02 Interface
/// @author Enzyme Foundation <security@enzyme.finance>
/// @dev Minimal interface for our interactions with Uniswap's SwapRouter02 (IV3SwapRouter).
/// Unlike the original SwapRouter (see IUniswapV3SwapRouter), `ExactInputParams` has no `deadline` field.
interface IUniswapV3SwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata) external payable returns (uint256);
}

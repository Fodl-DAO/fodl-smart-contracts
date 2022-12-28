// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

import './OneInchStructs.sol';

interface IOneInchAggregationRouter {
    function swap(
        address caller,
        OneInchStructs.SwapDescription calldata desc,
        bytes calldata data
    ) external payable returns (uint256 returnAmount, uint256 gasLeft);

    function unoswap(
        address srcToken,
        uint256 amount,
        uint256 minReturn,
        bytes32[] calldata pools
    ) external payable returns (uint256 returnAmount);
}

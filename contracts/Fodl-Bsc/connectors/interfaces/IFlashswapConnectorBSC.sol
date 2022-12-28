// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

interface IFlashswapConnectorBSC {
    function decreaseSimplePositionWithFlashswap(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 maxRedeemAmount,
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata exchangeData
    ) external;
}

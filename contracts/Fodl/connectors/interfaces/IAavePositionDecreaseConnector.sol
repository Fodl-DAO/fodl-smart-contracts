// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

interface IAavePositionDecreaseConnector {
    function aavePosition_Decrease(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 maxRedeemAmount,
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata exchangeData
    ) external;

    struct DecreasePreviewReturnVars {
        uint256 inputAmount;
        uint256 outputAmount;
        uint256 surplusBorrowAmount;
        uint256 supply;
        uint256 borrow;
        uint256 withdrawnAmount;
    }

    function aavePosition_DecreasePreview(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 maxRedeemAmount,
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata exchangeData
    ) external returns (DecreasePreviewReturnVars memory params);
}

// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;
pragma experimental ABIEncoderV2;

interface IAavePositionIncreaseConnector {
    function aavePosition_Increase(
        address platform,
        address supplyToken,
        uint256 principalAmount,
        uint256 minSuppliedAmount,
        address borrowToken,
        uint256 totalBorrowAmount,
        bytes calldata exchangeData
    ) external;

    struct IncreasePreviewReturnVars {
        uint256 inputAmount;
        uint256 outputAmount;
        uint256 supply;
        uint256 borrow;
    }

    function aavePosition_IncreasePreview(
        address platform,
        address supplyToken,
        uint256 principalAmount,
        uint256 minSuppliedAmount,
        address borrowToken,
        uint256 totalBorrowAmount,
        bytes memory exchangeData
    ) external returns (IncreasePreviewReturnVars memory params);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import '../interfaces/IAavePositionDecreaseConnector.sol';
import '../interfaces/IFundsManagerConnector.sol';
import '../interfaces/IClaimRewardsConnector.sol';

import '../../modules/FoldingAccount/solc7/FoldingAccountLib.sol';
import '../../modules/SimplePosition/solc7/SimplePositionLib.sol';

import './AavePositionBaseConnector.sol';

contract AavePositionDecreaseConnector is AavePositionBaseConnector, IAavePositionDecreaseConnector {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using DivByNonZero for uint256;

    constructor(
        address _aavePoolProvider,
        address _aaveData,
        address _aaveIncentives,
        address _oneInchRouter
    ) AavePositionBaseConnector(_aavePoolProvider, _aaveData, _aaveIncentives, _oneInchRouter) {}

    function aavePosition_Decrease(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256, /*maxRedeemAmount*/
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata /*exchangeData*/
    ) public override {
        requireSenderIsOwner();
        require(verifyPositionSetup(platform, supplyToken, borrowToken));

        if (minRepayAmount == 0) {
            uint256 supplyValue = getSupply(supplyToken);
            uint256 debtValue = getDebt(borrowToken).mul(getPrice(borrowToken, supplyToken)).div(MANTISSA);
            uint256 value = debtValue < supplyValue ? supplyValue - debtValue : 0;
            uint256 withdrawnAmount = IAaveLendingPool(IAaveLendingPoolProvider(PoolProvider).getLendingPool())
                .withdraw(supplyToken, withdrawAmount, address(this));

            IFundsManagerConnector(address(this)).withdraw(withdrawnAmount, value);

            if (AaveFlashloanStorageLibV7.getStorage().isPreview) {
                buildPreview(0, 0, 0, withdrawnAmount);
            }

            return;
        }

        uint256 debt = getDebt(borrowToken);
        if (minRepayAmount > debt) minRepayAmount = debt;

        uint256 positionValue;

        // Only precompute position value if the user is going to withdraw
        if (withdrawAmount > 0) {
            uint256 supplyValue = getSupply(supplyToken);
            uint256 debtValue = debt.mul(getPrice(borrowToken, supplyToken)).div(MANTISSA);
            if (debtValue < supplyValue) positionValue = supplyValue - debtValue;
        }

        address pool = IAaveLendingPoolProvider(PoolProvider).getLendingPool();
        // @dev: aave 's flashloan interface requires arrays as inputs
        // Unfortunately there is no way to inline a dynamic array, so we need to use
        // toArray to workaround it. Ugly but needed
        setCallbackCache(pool);

        IAaveLendingPool(pool).flashLoan(
            address(this),
            toArray(borrowToken),
            toArray(minRepayAmount),
            toArray(FLASHLOAN_BORROW_RATE_MODE),
            address(this),
            abi.encodePacked(positionValue, msg.data[4:]), // msg.data[4:] contains the payload (i.e. inputs) of the call
            REFERRAL_CODE
        );
    }

    /**
     * @dev meant to be used as a static call. Returns exchanged tokens, total supplied amount and total borrowed amount
     */
    function aavePosition_DecreasePreview(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 maxRedeemAmount,
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata exchangeData
    ) external override returns (DecreasePreviewReturnVars memory ret) {
        AaveFlashloanStorageLibV7.getStorage().isPreview = true;

        aavePosition_Decrease(
            platform,
            supplyToken,
            withdrawAmount,
            maxRedeemAmount,
            borrowToken,
            minRepayAmount,
            exchangeData
        );
        ret = abi.decode(AaveFlashloanStorageLibV7.getStorage().returnData, (DecreasePreviewReturnVars));
        delete AaveFlashloanStorageLibV7.getStorage().returnData;
        delete AaveFlashloanStorageLibV7.getStorage().isPreview;
    }

    /**
     * @dev this is the callback function from AAVE for flashloans
     * @notice 1. repays debt with a flashloan, 2. exchanges available supply to repay flashloan, 3. withdraws to the user
     */
    function executeOperation(
        address[] calldata, /*assets*/
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address, /*initiator*/
        bytes calldata callbackData
    ) external override returns (bool) {
        validateAndClearCallback();

        // Manually decoding each variable in callbackData: workaround stack too deep
        address borrowToken = abi.decode(callbackData[160:192], (address));

        // Step 1: repay debt
        ERC20(borrowToken).safeApprove(msg.sender, amounts[0] * 2 + premiums[0]); // No need to check overflows: aave has safe math integrated
        IAaveLendingPool(msg.sender).repay(borrowToken, amounts[0], VARIABLE_BORROW_RATE_MODE, address(this));

        // Step 2: compute amounts to exchange and withdraw
        address supplyToken = abi.decode(callbackData[64:96], (address));
        uint256 withdrawAmount = abi.decode(callbackData[96:128], (uint256));
        uint256 flashloanDebt = amounts[0] + premiums[0];

        uint256 maxRedeemAmount = supplyToken == borrowToken
            ? flashloanDebt
            : abi.decode(callbackData[128:160], (uint256));

        if (withdrawAmount == type(uint256).max)
            withdrawAmount = IAaveLendingPool(msg.sender).withdraw(supplyToken, type(uint256).max, address(this)).sub(
                maxRedeemAmount
            ); // If withdrawAmount == max, redeem all supply and compute remaining withdrawable
        else IAaveLendingPool(msg.sender).withdraw(supplyToken, maxRedeemAmount.add(withdrawAmount), address(this));

        uint256 surplusBorrowAmount;
        if (borrowToken != supplyToken)
            surplusBorrowAmount = oneInchSwap(supplyToken, maxRedeemAmount, flashloanDebt, callbackData[288:]).sub(
                flashloanDebt
            );

        if (surplusBorrowAmount > 0)
            ERC20(borrowToken).safeTransfer(FoldingAccountLibV7.getStorage().owner, surplusBorrowAmount);

        if (withdrawAmount > 0)
            IFundsManagerConnector(address(this)).withdraw(withdrawAmount, abi.decode(callbackData[0:32], (uint256)));

        if (AaveFlashloanStorageLibV7.getStorage().isPreview)
            buildPreview(maxRedeemAmount, flashloanDebt.add(surplusBorrowAmount), surplusBorrowAmount, withdrawAmount);

        return true;
    }

    function buildPreview(
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 surplusBorrowAmount,
        uint256 withdrawnAmount
    ) internal {
        AaveFlashloanStorageLibV7.getStorage().returnData = abi.encode(
            DecreasePreviewReturnVars({
                inputAmount: inputAmount,
                outputAmount: outputAmount,
                surplusBorrowAmount: surplusBorrowAmount,
                withdrawnAmount: withdrawnAmount,
                supply: getSupply(SimplePositionLibV7.getStorage().supplyToken),
                borrow: getDebt(SimplePositionLibV7.getStorage().borrowToken)
            })
        );
    }
}

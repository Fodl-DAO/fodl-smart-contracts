// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import '../interfaces/IAavePositionIncreaseConnector.sol';
import '../interfaces/IFundsManagerConnector.sol';

import '../../modules/FoldingAccount/solc7/FoldingAccountLib.sol';
import '../../modules/SimplePosition/solc7/SimplePositionLib.sol';

import './AavePositionBaseConnector.sol';

contract AavePositionIncreaseConnector is AavePositionBaseConnector, IAavePositionIncreaseConnector {
    using SafeERC20 for ERC20;
    using SafeMath for uint256;
    using DivByNonZero for uint256;

    constructor(
        address _aavePoolProvider,
        address _aaveData,
        address _aaveIncentives,
        address _oneInchRouter
    ) AavePositionBaseConnector(_aavePoolProvider, _aaveData, _aaveIncentives, _oneInchRouter) {}

    function aavePosition_Increase(
        address platform,
        address supplyToken,
        uint256 principalAmount,
        uint256, /*minSuppliedAmount*/
        address borrowToken,
        uint256 totalBorrowAmount,
        bytes calldata /*exchangeData*/
    ) public override {
        requireSenderIsOwnerOrRegistry();
        require(
            verifyPositionSetup(platform, supplyToken, borrowToken) || setupPosition(platform, supplyToken, borrowToken)
        );

        address pool = IAaveLendingPoolProvider(PoolProvider).getLendingPool();

        if (principalAmount > 0) IFundsManagerConnector(address(this)).addPrincipal(principalAmount);

        if (totalBorrowAmount == 0) {
            ERC20(supplyToken).safeApprove(pool, principalAmount);
            return IAaveLendingPool(pool).deposit(supplyToken, principalAmount, address(this), REFERRAL_CODE);
        }

        // @dev: aave 's flashloan interface requires arrays as inputs
        // Unfortunately there is no way to inline a dynamic array, so we need to use
        // toArray to workaround it. Ugly but needed
        setCallbackCache(pool);
        IAaveLendingPool(pool).flashLoan(
            address(this),
            toArray(borrowToken),
            toArray(totalBorrowAmount),
            toArray(VARIABLE_BORROW_RATE_MODE),
            address(this),
            msg.data[4:],
            REFERRAL_CODE
        );
    }

    /**
     * @dev meant to be used as a static call. Returns exchanged tokens, total supplied amount and total borrowed amount
     */
    function aavePosition_IncreasePreview(
        address platform,
        address supplyToken,
        uint256 principalAmount,
        uint256 minSuppliedAmount,
        address borrowToken,
        uint256 totalBorrowAmount,
        bytes calldata exchangeData
    ) external override returns (IncreasePreviewReturnVars memory ret) {
        AaveFlashloanStorageLibV7.getStorage().isPreview = true;
        require(totalBorrowAmount > 0);

        aavePosition_Increase(
            platform,
            supplyToken,
            principalAmount,
            minSuppliedAmount,
            borrowToken,
            totalBorrowAmount,
            exchangeData
        );
        ret = abi.decode(AaveFlashloanStorageLibV7.getStorage().returnData, (IncreasePreviewReturnVars));
        delete AaveFlashloanStorageLibV7.getStorage().returnData;
        delete AaveFlashloanStorageLibV7.getStorage().isPreview;
    }

    /**
     * @dev this is the callback function from AAVE for flashloans
     */
    function executeOperation(
        address[] calldata, /*assets*/
        uint256[] calldata, /*amounts*/
        uint256[] calldata, /*premiums*/
        address, /*initiator*/
        bytes calldata callbackData
    ) external override returns (bool) {
        validateAndClearCallback();

        (
            ,
            address supplyToken,
            uint256 principalAmount,
            uint256 minSuppliedAmount,
            address borrowToken,
            uint256 totalBorrowAmount
        ) = abi.decode(callbackData, (address, address, uint256, uint256, address, uint256));

        uint256 amountToSupply;
        if (borrowToken == supplyToken) amountToSupply = principalAmount.add(totalBorrowAmount);
        else
            amountToSupply = oneInchSwap(
                borrowToken,
                totalBorrowAmount,
                minSuppliedAmount.sub(principalAmount),
                callbackData[256:]
            ).add(principalAmount);

        ERC20(supplyToken).safeApprove(msg.sender, amountToSupply);

        IAaveLendingPool(msg.sender).deposit(supplyToken, amountToSupply, address(this), REFERRAL_CODE);

        if (AaveFlashloanStorageLibV7.getStorage().isPreview) {
            uint256 borrow = getDebt(SimplePositionLibV7.getStorage().borrowToken);
            borrow = borrow.add(totalBorrowAmount);

            AaveFlashloanStorageLibV7.getStorage().returnData = abi.encode(
                IncreasePreviewReturnVars({
                    inputAmount: totalBorrowAmount,
                    outputAmount: amountToSupply.sub(principalAmount),
                    supply: getSupply(supplyToken),
                    borrow: borrow
                })
            );
        }

        return true;
    }
}

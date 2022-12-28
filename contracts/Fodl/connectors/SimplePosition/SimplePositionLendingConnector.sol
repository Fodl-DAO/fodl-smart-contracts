// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

import '../interfaces/ISimplePositionLendingConnector.sol';
import '../interfaces/IFundsManagerConnector.sol';
import '../../modules/Lender/LendingDispatcher.sol';
import '../../modules/SimplePosition/SimplePositionStorage.sol';

import '../../core/FoldingRegistry.sol';

import 'hardhat/console.sol';

contract SimplePositionLendingConnector is LendingDispatcher, SimplePositionStorage, ISimplePositionLendingConnector {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    function increaseSimplePositionWithFunds(
        address platform,
        address supplyToken,
        uint256 supplyAmount,
        address borrowToken,
        uint256 borrowAmount
    ) external override onlyAccountOwnerOrRegistry {
        address lender = getLender(platform);
        if (isSimplePosition()) {
            requireSimplePositionDetails(platform, supplyToken, borrowToken);
        } else {
            simplePositionStore().platform = platform;
            simplePositionStore().supplyToken = supplyToken;
            simplePositionStore().borrowToken = borrowToken;

            address[] memory markets = new address[](2);
            markets[0] = supplyToken;
            markets[1] = borrowToken;
            enterMarkets(lender, platform, markets);
        }

        address accountOwner = accountOwner();

        if (supplyAmount > 0) {
            if (fundsManagerConnectorEnabled()) {
                uint256 principal = supplyAmount;
                if (borrowAmount > 0) {
                    uint256 borrowValue = borrowAmount.mul(getReferencePrice(lender, platform, borrowToken)).div(
                        getReferencePrice(lender, platform, supplyToken)
                    );
                    principal = supplyAmount.sub(borrowValue);
                }
                IFundsManagerConnector(address(this)).addPrincipal(principal);
                IERC20(supplyToken).safeTransferFrom(accountOwner, address(this), supplyAmount.sub(principal));
            }
            supply(lender, platform, supplyToken, supplyAmount);
        }

        if (borrowAmount > 0) {
            borrow(lender, platform, borrowToken, borrowAmount);
            IERC20(borrowToken).safeTransfer(accountOwner, borrowAmount);
        }
    }

    function decreaseSimplePositionWithFunds(
        address platform,
        address supplyToken,
        uint256 supplyAmount,
        address borrowToken,
        uint256 borrowAmount
    ) external override onlyAccountOwner {
        require(isSimplePosition(), 'SP1');
        requireSimplePositionDetails(platform, supplyToken, borrowToken);

        address accountOwner = accountOwner();
        address lender = getLender(platform);
        uint256 startPositionValue = _getPositionValue(lender, platform, supplyToken, borrowToken);

        if (borrowAmount > 0) {
            IERC20(borrowToken).safeTransferFrom(accountOwner, address(this), borrowAmount);
            repayBorrow(lender, platform, borrowToken, borrowAmount);
        }

        if (supplyAmount > 0) {
            redeemSupply(lender, platform, supplyToken, supplyAmount);
            if (fundsManagerConnectorEnabled()) {
                IFundsManagerConnector(address(this)).withdraw(supplyAmount, startPositionValue);
            }
        }
    }

    function _getPositionValue(
        address lender,
        address platform,
        address supplyToken,
        address borrowToken
    ) internal returns (uint256) {
        uint256 borrowBalanceValue = getBorrowBalance(lender, platform, borrowToken)
            .mul(getReferencePrice(lender, platform, borrowToken))
            .div(getReferencePrice(lender, platform, supplyToken));

        uint256 supplyBalanceValue = getSupplyBalance(lender, platform, supplyToken);
        if (borrowBalanceValue > supplyBalanceValue) return 0;

        return supplyBalanceValue - borrowBalanceValue;
    }

    function fundsManagerConnectorEnabled() internal view returns (bool) {
        address payable foldingRegistry = payable(aStore().foldingRegistry);
        return
            FoldingRegistry(foldingRegistry).getImplementation(IFundsManagerConnector.withdraw.selector) != address(0);
    }
}

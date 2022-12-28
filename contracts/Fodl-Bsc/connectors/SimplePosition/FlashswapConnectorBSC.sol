// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/math/Math.sol';

import '../interfaces/IFlashswapConnectorBSC.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol';
import '@uniswap/v2-core/contracts/interfaces/IUniswapV2Callee.sol';

import '../../../../contracts/Fodl/connectors/SimplePosition/SimplePositionBaseConnector.sol';
import '../../../../contracts/Fodl/modules/Exchanger/ExchangerDispatcher.sol';
import '../../../../contracts/Fodl/modules/FundsManager/FundsManager.sol';
import '../../../../contracts/Fodl/core/interfaces/IExchangerAdapterProvider.sol';

import '../../modules/Lender/Venus/IVenus.sol';
import { LendingDispatcherBSC } from '../../modules/Lender/LendingDispatcherBSC.sol';

contract FlashswapConnectorBSC is
    IFlashswapConnectorBSC,
    SimplePositionBaseConnector,
    ExchangerDispatcher,
    LendingDispatcherBSC,
    FundsManager
{
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address private constant BSCUSDT = 0x55d398326f99059fF775485246999027B3197955;
    address private constant BSCUSDC = 0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d;
    address private constant BSCDAI = 0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3;
    address private constant BSCBUSD = 0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56;
    address private constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address private constant BTCB = 0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c;
    address private constant BSCETH = 0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
    address private constant XRP = 0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE;
    address private constant ADA = 0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47;
    address private constant DOGE = 0xbA2aE424d960c26247Dd6c32edC70B295c744C43;
    address private constant DOT = 0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402;
    address private constant CAKE = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
    address private constant XVS = 0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63;

    uint256 private constant PANCAKESWAP_FEE_NUM = 300;
    uint256 private constant PANCAKESWAP_FEE_DEN = 100000;

    uint256 public immutable rewardsFactor;
    address public immutable pancakeswapFactory;
    address private immutable SELF_ADDRESS;

    constructor(
        uint256 _principal,
        uint256 _profit,
        uint256 _rewardsFactor,
        address _holder,
        address _pancakeswapFactory
    ) public FundsManager(_principal, _profit, _holder) {
        rewardsFactor = _rewardsFactor;
        pancakeswapFactory = _pancakeswapFactory;
        SELF_ADDRESS = address(this);
    }

    /**
     * platform - The lender, ex. Venus Comptroller
     * supplyToken - The supplied token to platform in existing position
     * withdrawAmount - Amount of supplyToken to redeem and transferTo accountOwner
     * maxRedeemAmount - Decrease position by redeeming at most this amount of supplied token. Can be greater than supplied amount to support zero dust withdrawals
     * borrowToken - The borrowed token from platform in existing position
     * minRepayAmount - Repay debt of at least this amount of borrowToken or revert. Used to protect from unwanted slippage
     * exchangeData - ABI encoded (bytes1, address[]), for (getExchangerAdapter, swapPath). Required for swapping supplyToken to borrowToken, when not same token
     */
    function decreaseSimplePositionWithFlashswap(
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 maxRedeemAmount,
        address borrowToken,
        uint256 minRepayAmount,
        bytes calldata exchangeData
    ) external override onlyAccountOwner {
        requireSimplePositionDetails(platform, supplyToken, borrowToken);

        address lender = getLender(platform);

        accrueInterest(lender, platform, supplyToken);
        accrueInterest(lender, platform, borrowToken);

        uint256 startBorrowBalance = getBorrowBalance();
        uint256 startPositionValue = _getPositionValue(lender, platform, supplyToken, borrowToken);

        maxRedeemAmount = Math.min(maxRedeemAmount, getSupplyBalance()); // Cap maxRedeemAmount
        minRepayAmount = Math.min(minRepayAmount, getBorrowBalance()); // Cap minRepayAmount

        // Flashswap exactIn: maxRedeemAmount, then exchange back to debt token, repay debt, redeem and repay flash, then swap back the surplus
        if (minRepayAmount > 0) {
            if (supplyToken == borrowToken) flashloanInPancake(supplyToken, minRepayAmount);
            if (supplyToken != borrowToken && maxRedeemAmount > 0)
                flashswapInPancake(maxRedeemAmount, supplyToken, exchangeData);
        }

        require(startBorrowBalance.sub(getBorrowBalance()) >= minRepayAmount, 'SPFC02');

        if (supplyToken != borrowToken && getBorrowBalance() == 0) {
            _swapExcessBorrowTokens(supplyToken, borrowToken, exchangeData);
        }

        if (withdrawAmount > 0) {
            _redeemAndWithdraw(lender, platform, supplyToken, withdrawAmount, startPositionValue);
        }

        if (IERC20(supplyToken).balanceOf(address(this)) > 0) {
            supply(lender, platform, supplyToken, IERC20(supplyToken).balanceOf(address(this)));
        }

        if (getBorrowBalance() == 0) {
            _claimRewards(lender, platform);
        }
    }

    function flashloanInPancake(address token, uint256 repayAmount) internal {
        address flashpair;
        if (token == BSCUSDT) flashpair = 0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE;
        if (token == BSCUSDC) flashpair = 0xEc6557348085Aa57C72514D67070dC863C0a5A8c;
        if (token == BSCDAI) flashpair = 0x66FDB2eCCfB58cF098eaa419e5EfDe841368e489;
        if (token == BSCBUSD) flashpair = 0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16;
        if (token == WBNB) flashpair = 0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16;
        if (token == BTCB) flashpair = 0xF45cd219aEF8618A92BAa7aD848364a158a24F33;
        if (token == BSCETH) flashpair = 0x74E4716E431f45807DCF19f284c7aA99F18a4fbc;
        if (token == XRP) flashpair = 0x03F18135c44C64ebFdCBad8297fe5bDafdBbdd86;
        if (token == ADA) flashpair = 0x28415ff2C35b65B9E5c7de82126b4015ab9d031F;
        if (token == DOGE) flashpair = 0xac109C8025F272414fd9e2faA805a583708A017f;
        if (token == DOT) flashpair = 0xDd5bAd8f8b360d76d12FdA230F8BAF42fe0022CF;
        if (token == CAKE) flashpair = 0x0eD7e52944161450477ee417DE9Cd3a859b14fD0;
        if (token == XVS) flashpair = 0x7EB5D86FD78f3852a3e0e064f2842d45a3dB6EA2;
        require(flashpair != address(0), 'Unavailable flashloan for token');
        require(IERC20(token).balanceOf(flashpair) >= repayAmount, 'Insufficient balance');

        setExpectedCallback();
        if (token == IUniswapV2Pair(flashpair).token0())
            IUniswapV2Pair(flashpair).swap(repayAmount, 0, address(this), abi.encodePacked(repayAmount, msg.data[4:]));
        else IUniswapV2Pair(flashpair).swap(0, repayAmount, address(this), abi.encodePacked(repayAmount, msg.data[4:]));
    }

    function flashswapInPancake(
        uint256 maxRedeemAmount,
        address supplyToken,
        bytes calldata exchangeData
    ) internal {
        address[] memory tokens = abi.decode(abi.encodePacked(bytes32(uint256(0x20)), exchangeData[64:]), (address[]));

        (address token0, address token1) = tokens[0] < tokens[1] ? (tokens[0], tokens[1]) : (tokens[1], tokens[0]);
        IUniswapV2Pair flashpair = IUniswapV2Pair(IUniswapV2Factory(pancakeswapFactory).getPair(token0, token1));

        uint256 amountOut0;
        uint256 amountOut1;
        {
            (uint256 reserve0, uint256 reserve1, ) = flashpair.getReserves();
            (amountOut0, amountOut1) = token0 == supplyToken
                ? (uint256(0), (getAmountOut(maxRedeemAmount, reserve0, reserve1)))
                : (getAmountOut(maxRedeemAmount, reserve1, reserve0), uint256(0));
        }
        setExpectedCallback();
        flashpair.swap(amountOut0, amountOut1, address(this), abi.encodePacked(maxRedeemAmount, msg.data[4:])); // Leave msg.sig out
    }

    function pancakeCall(
        address,
        uint256 amount0Out,
        uint256 amount1Out,
        bytes calldata callbackData
    ) external {
        require(amount0Out == 0 || amount1Out == 0);
        clearCallback();

        bytes calldata msgData = callbackData[32:];

        address supplyToken = abi.decode(msgData[32:64], (address));
        address borrowToken = abi.decode(msgData[128:160], (address));

        if (supplyToken == borrowToken) {
            uint256 repayAmount = amount0Out > 0 ? amount0Out : amount1Out;

            address platform = abi.decode(msgData[0:32], (address));
            address lender = getLender(platform);

            repayBorrow(lender, platform, borrowToken, repayAmount);

            uint256 flashRepayAmount = repayAmount.add(repayAmount.mul(PANCAKESWAP_FEE_NUM).div(PANCAKESWAP_FEE_DEN));
            redeemSupply(lender, platform, supplyToken, flashRepayAmount);

            IERC20(supplyToken).safeTransfer(msg.sender, flashRepayAmount);

            return;
        }

        (, , , , , , bytes memory exchangeData) = abi.decode(
            msgData,
            (address, address, uint256, uint256, address, uint256, bytes)
        );

        (, address[] memory tokens) = abi.decode(exchangeData, (bytes1, address[]));
        if (tokens.length > 2) {
            address[] memory restOfPath = new address[](tokens.length - 1);
            for (uint256 i = 1; i < tokens.length; ) {
                restOfPath[i - 1] = tokens[i];
                ++i;
            }

            exchange(
                IExchangerAdapterProvider(aStore().foldingRegistry).getExchangerAdapter(exchangeData[0]),
                restOfPath[0],
                borrowToken,
                amount0Out > amount1Out ? amount0Out : amount1Out,
                1,
                abi.encode(exchangeData[0], restOfPath)
            );
        }

        address platform = abi.decode(msgData[0:32], (address));
        address lender = getLender(platform);

        repayBorrow(
            lender,
            platform,
            borrowToken,
            Math.min(getBorrowBalance(), IERC20(borrowToken).balanceOf(address(this)))
        );

        uint256 maxRedeemAmount = abi.decode(callbackData[:32], (uint256));
        redeemSupply(lender, platform, supplyToken, maxRedeemAmount);
        IERC20(supplyToken).safeTransfer(msg.sender, maxRedeemAmount);
    }

    /**
     * @return Encoded exchange data (bytes1, address[]) with reversed path
     */
    function reversePath(bytes memory exchangeData) public pure returns (bytes memory) {
        (bytes1 flag, address[] memory path) = abi.decode(exchangeData, (bytes1, address[]));

        uint256 length = path.length;
        address[] memory reversed = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            reversed[length - 1 - i] = path[i];
        }

        return abi.encode(flag, reversed);
    }

    function _getPositionValue(
        address lender,
        address platform,
        address supplyToken,
        address borrowToken
    ) private returns (uint256) {
        uint256 borrowBalanceValue = getBorrowBalance().mul(getReferencePrice(lender, platform, borrowToken)).div(
            getReferencePrice(lender, platform, supplyToken)
        );
        uint256 supplyBalanceValue = getSupplyBalance();
        if (borrowBalanceValue > supplyBalanceValue) return 0;

        return supplyBalanceValue - borrowBalanceValue;
    }

    function _swapExcessBorrowTokens(
        address supplyToken,
        address borrowToken,
        bytes memory exchangeData
    ) private {
        uint256 borrowTokenBalance = IERC20(borrowToken).balanceOf(address(this));
        if (borrowTokenBalance > 0) {
            bytes memory reversedExchangeData = reversePath(exchangeData);
            exchange(
                IExchangerAdapterProvider(aStore().foldingRegistry).getExchangerAdapter(reversedExchangeData[0]),
                borrowToken,
                supplyToken,
                borrowTokenBalance,
                1,
                reversedExchangeData
            );
        }
    }

    function _redeemAndWithdraw(
        address lender,
        address platform,
        address supplyToken,
        uint256 withdrawAmount,
        uint256 startPositionValue
    ) private {
        uint256 supplyTokenBalance = IERC20(supplyToken).balanceOf(address(this));
        if (withdrawAmount > supplyTokenBalance) {
            uint256 redeemAmount = withdrawAmount - supplyTokenBalance;
            if (redeemAmount > getSupplyBalance()) {
                redeemAll(lender, platform, supplyToken); // zero dust redeem
            } else {
                redeemSupply(lender, platform, supplyToken, redeemAmount);
            }
        }

        withdrawAmount = Math.min(withdrawAmount, IERC20(supplyToken).balanceOf(address(this))); // zero dust withdraw
        withdraw(withdrawAmount, startPositionValue); // if position value = 0, fund smanager will throw with a division by 0
    }

    function _claimRewards(address lender, address platform) private {
        (address rewardsToken, uint256 rewardsAmount) = claimRewards(lender, platform);
        if (rewardsToken != address(0)) {
            uint256 subsidy = rewardsAmount.mul(rewardsFactor).div(MANTISSA);
            if (subsidy > 0) {
                IERC20(rewardsToken).safeTransfer(holder, subsidy);
            }
            if (rewardsAmount > subsidy) {
                IERC20(rewardsToken).safeTransfer(accountOwner(), rewardsAmount - subsidy);
            }
        }
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(amountIn > 0, 'UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint256 amountInWithFee = amountIn * 99750;
        uint256 numerator = amountInWithFee * (reserveOut);
        uint256 denominator = (reserveIn * (100000)) + (amountInWithFee);
        amountOut = numerator / denominator;
    }

    function setExpectedCallback() internal {
        aStore().callbackTarget = SELF_ADDRESS;
        aStore().expectedCallbackSig = this.pancakeCall.selector;
    }

    function clearCallback() internal {
        delete aStore().callbackTarget;
        delete aStore().expectedCallbackSig;
    }
}

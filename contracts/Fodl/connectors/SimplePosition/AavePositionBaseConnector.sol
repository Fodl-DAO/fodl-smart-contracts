// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';

import '../../../Libs/DivByNonZero.sol';
import '../../modules/FlashLoaner/AaveFlashloanStorage/solc7/AaveFlashloanStorageV7.sol';
import '../../modules/FoldingAccount/solc7/FoldingAccountLib.sol';
import '../../modules/SimplePosition/solc7/SimplePositionLib.sol';

import '../../../Libs/OneInch/IOneInchAggregationRouter.sol';
import { IFlashLoanReceiver, IAaveLendingPool, IAaveDataProvider, IAaveLendingPoolProvider, IAavePriceOracleGetter } from '../../modules/Lender/Aave/Interfaces.sol';

abstract contract AavePositionBaseConnector is IFlashLoanReceiver {
    using DivByNonZero for uint256;
    using SafeMath for uint256;
    using SafeERC20 for ERC20;

    uint256 internal constant MANTISSA = 1e18;
    uint16 internal constant REFERRAL_CODE = 0;
    uint256 internal constant FLASHLOAN_BORROW_RATE_MODE = 0;
    uint256 internal constant VARIABLE_BORROW_RATE_MODE = 2;

    bytes4 internal constant SWAP_SELECTOR = 0x7c025200;
    bytes4 internal constant UNOSWAP_SELECTOR = 0x2e95b6c8;

    address internal immutable SELF_ADDRESS = address(this);
    address internal immutable PoolProvider; // IAaveLendingPoolProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);
    address internal immutable DataProvider; // IAaveDataProvider(0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d);
    address internal immutable Incentives; // IAaveIncentivesController(0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5);
    address internal immutable oneInchRouter;

    constructor(
        address _aavePoolProvider,
        address _aaveData,
        address _aaveIncentives,
        address _oneInchRouter
    ) {
        PoolProvider = _aavePoolProvider;
        DataProvider = _aaveData;
        Incentives = _aaveIncentives;
        oneInchRouter = _oneInchRouter;
    }

    function setCallbackCache(address caller) internal {
        FoldingAccountLibV7.Storage storage accountStorage = FoldingAccountLibV7.getStorage();
        accountStorage.callbackTarget = SELF_ADDRESS;
        accountStorage.expectedCallbackSig = IFlashLoanReceiver.executeOperation.selector;

        AaveFlashloanStorageLibV7.Storage storage flashloanStorage = AaveFlashloanStorageLibV7.getStorage();
        flashloanStorage.expectedCallbackCaller = caller;
    }

    function validateAndClearCallback() internal {
        AaveFlashloanStorageLibV7.Storage storage flashloanStorage = AaveFlashloanStorageLibV7.getStorage();
        require(flashloanStorage.expectedCallbackCaller == msg.sender, 'UNEXPECTED_CALLBACK_CALLER');
        delete flashloanStorage.expectedCallbackCaller;

        FoldingAccountLibV7.Storage storage accountStorage = FoldingAccountLibV7.getStorage();
        delete accountStorage.callbackTarget;
        delete accountStorage.expectedCallbackSig;
    }

    // @dev: semantically this function is read as "get price of token [e.g. ETH] in token [e.g. DAI], return unit is [e.g. DAI/ETH]"
    function getPrice(address ofToken, address inToken) internal view returns (uint256) {
        address[] memory assets = new address[](2);
        assets[0] = ofToken;
        assets[1] = inToken;

        uint256[] memory prices = IAavePriceOracleGetter(IAaveLendingPoolProvider(PoolProvider).getPriceOracle())
            .getAssetsPrices(assets);

        return
            (prices[0].mul(MANTISSA).mul(10**ERC20(inToken).decimals())).divByNonZero( // prices[0] = ref / ofToken
                (prices[1].mul(10**ERC20(ofToken).decimals())) // prices[1] = ref / inToken
            ); // prices[0] / prices[1] = inToken / ofToken
    }

    /**
     * @dev
     */
    function derivePrice(
        address ofToken,
        address inToken,
        uint256 ofTokenAmount,
        uint256 inTokenAmount
    ) internal view returns (uint256) {
        return
            MANTISSA.mul(inTokenAmount).mul(10**ERC20(inToken).decimals()).divByNonZero(
                ofTokenAmount.mul(10**ERC20(ofToken).decimals())
            );
    }

    function toArray(uint256 value) internal pure returns (uint256[] memory array) {
        array = new uint256[](1);
        array[0] = value;
    }

    function toArray(address value) internal pure returns (address[] memory array) {
        array = new address[](1);
        array[0] = value;
    }

    function oneInchSwap(
        address tokenIn,
        uint256 inputAmount,
        uint256 minReturnAmount,
        bytes calldata oneInchData
    ) internal returns (uint256 outputAmount) {
        bytes4 selector = (bytes4(oneInchData[0]) |
            (bytes4(oneInchData[1]) >> 8) |
            (bytes4(oneInchData[2]) >> 16) |
            (bytes4(oneInchData[3]) >> 24));

        if (selector == SWAP_SELECTOR) {
            (address caller, OneInchStructs.SwapDescription memory description, bytes memory data) = abi.decode(
                oneInchData[4:],
                (address, OneInchStructs.SwapDescription, bytes)
            );
            description.amount = inputAmount;
            description.minReturnAmount = minReturnAmount;
            description.flags = 0; // Disable all flags - skips approval, saves gas
            ERC20(description.srcToken).safeTransfer(description.srcReceiver, inputAmount);
            (outputAmount, ) = IOneInchAggregationRouter(oneInchRouter).swap(caller, description, data);
        } else if (selector == UNOSWAP_SELECTOR) {
            (, , , bytes32[] memory pools) = abi.decode(oneInchData[4:], (address, uint256, uint256, bytes32[]));

            ERC20(tokenIn).safeApprove(oneInchRouter, inputAmount);
            outputAmount = IOneInchAggregationRouter(oneInchRouter).unoswap(
                tokenIn,
                inputAmount,
                minReturnAmount,
                pools
            );
        } else revert('BAD_ONE_INCH_DECODE_SELECTOR');
    }

    function _parseRevertReason(bytes memory reason) internal pure {
        if (reason.length > 0) {
            // solhint-disable-next-line no-inline-assembly
            assembly {
                let reason_size := mload(reason)
                revert(add(32, reason), reason_size)
            }
        }

        revert('Unknown');
    }

    function verifyPositionSetup(
        address platform,
        address supplyToken,
        address borrowToken
    ) internal view returns (bool) {
        SimplePositionLibV7.Storage storage s = SimplePositionLibV7.getStorage();

        return (s.platform == platform && s.supplyToken == supplyToken && s.borrowToken == borrowToken);
    }

    function setupPosition(
        address platform,
        address supplyToken,
        address borrowToken
    ) internal returns (bool) {
        require(platform != address(0));
        require(supplyToken != address(0));
        require(borrowToken != address(0));

        SimplePositionLibV7.Storage storage s = SimplePositionLibV7.getStorage();
        require(s.platform == address(0));

        s.platform = platform;
        s.supplyToken = supplyToken;
        s.borrowToken = borrowToken;

        return true;
    }

    function requireSenderIsOwnerOrRegistry() internal view {
        FoldingAccountLibV7.Storage memory s = FoldingAccountLibV7.getStorage();
        require(msg.sender == s.owner || msg.sender == s.foldingRegistry, 'NOT_AUTHORIZED');
    }

    function requireSenderIsOwner() internal view {
        require(FoldingAccountLibV7.getStorage().owner == msg.sender, 'NOT_AUTHORIZED');
    }

    function getDebt(address token) internal view returns (uint256 debt) {
        (, , debt, , , , , , ) = IAaveDataProvider(DataProvider).getUserReserveData(token, address(this));
    }

    function getSupply(address token) internal view returns (uint256 supply) {
        (supply, , , , , , , , ) = IAaveDataProvider(DataProvider).getUserReserveData(token, address(this));
    }
}

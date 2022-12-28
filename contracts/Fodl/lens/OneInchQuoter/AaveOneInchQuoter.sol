// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import '../../../Libs/OneInch/IOneInchAggregationRouter.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/SafeERC20.sol';

import { IFlashLoanReceiver, IAaveLendingPool, IAaveLendingPoolProvider } from '../../modules/Lender/Aave/Interfaces.sol';

contract AaveOneInchQuoter is IFlashLoanReceiver {
    using SafeERC20 for IERC20;

    IAaveLendingPoolProvider immutable poolProvider;
    IOneInchAggregationRouter immutable router;

    bytes4 private constant SWAP_SELECTOR = 0x7c025200;
    bytes4 private constant UNOSWAP_SELECTOR = 0x2e95b6c8;

    address public owner;
    address private expectedCallbackCaller;

    constructor(address _aaveLendingPool, address _router) {
        poolProvider = IAaveLendingPoolProvider(_aaveLendingPool);
        router = IOneInchAggregationRouter(_router);
        owner = msg.sender;
    }

    function quote(uint256 inputAmount, bytes calldata oneInchTxData) external returns (uint256) {
        bytes4 selector = decodeSelector(oneInchTxData);
        address srcToken;

        if (selector == SWAP_SELECTOR) srcToken = abi.decode(oneInchTxData[100:132], (address));
        else if (selector == UNOSWAP_SELECTOR) srcToken = abi.decode(oneInchTxData[4:36], (address));
        else revert('Unknown selector');

        IAaveLendingPool aaveLendingPool = IAaveLendingPool(poolProvider.getLendingPool());
        expectedCallbackCaller = address(aaveLendingPool);

        try
            aaveLendingPool.flashLoan(
                address(this),
                toArray(srcToken),
                toArray(inputAmount),
                toArray(0),
                address(this),
                oneInchTxData,
                0
            )
        {
            revert('operation succeeded');
        } catch (bytes memory reason) {
            return parseRevertReason(reason);
        }
    }

    function executeOperation(
        address[] calldata, /*assets*/
        uint256[] calldata amounts,
        uint256[] calldata, /*premiums*/
        address, /*initiator*/
        bytes calldata oneInchTxData
    ) external override returns (bool) {
        require(msg.sender == expectedCallbackCaller);
        expectedCallbackCaller = address(0);

        bytes4 selector = decodeSelector(oneInchTxData);
        if (selector == SWAP_SELECTOR) quoteSwap(amounts, oneInchTxData[4:]);
        else if (selector == UNOSWAP_SELECTOR) quoteUnoswap(amounts, oneInchTxData[4:]);
        else revert('Unknown selector');
        return true;
    }

    function quoteUnoswap(uint256[] calldata amounts, bytes calldata oneInchTxData) internal {
        (address srcToken, , uint256 minReturn, bytes32[] memory pools) = abi.decode(
            oneInchTxData,
            (address, uint256, uint256, bytes32[])
        );
        minReturn = 1;

        IERC20(srcToken).safeApprove(address(router), amounts[0]);

        uint256 outputAmount = router.unoswap(srcToken, amounts[0], minReturn, pools);
        revertWithOutputAmount(outputAmount);
    }

    function quoteSwap(uint256[] calldata amounts, bytes calldata oneInchTxData) internal {
        (address caller, OneInchStructs.SwapDescription memory description, bytes memory callBytes) = abi.decode(
            oneInchTxData,
            (address, OneInchStructs.SwapDescription, bytes)
        );

        description.amount = amounts[0];
        description.minReturnAmount = 1;
        description.flags = 0; // Disable all flags - skips approval, saves gas

        (bool success, bytes memory err) = description.srcToken.call(
            abi.encodeWithSelector(IERC20.transfer.selector, description.srcReceiver, amounts[0])
        );
        if (!success) parseRevertReason(err);

        (uint256 outputAmount, ) = router.swap(caller, description, callBytes);
        revertWithOutputAmount(outputAmount);
    }

    function parseRevertReason(bytes memory reason) internal pure returns (uint256 outputAmount) {
        if (reason.length == 0) revert('External call reverted without reason');
        if (reason.length != 32) {
            assembly {
                reason := add(reason, 0x04)
            }
            revert(abi.decode(reason, (string)));
        }
        return abi.decode(reason, (uint256));
    }

    function revertWithOutputAmount(uint256 outputAmount) internal pure {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, outputAmount)
            revert(ptr, 32)
        }
    }

    function toArray(uint256 value) internal pure returns (uint256[] memory array) {
        array = new uint256[](1);
        array[0] = value;
    }

    function toArray(address value) internal pure returns (address[] memory array) {
        array = new address[](1);
        array[0] = value;
    }

    function decodeSelector(bytes calldata data) internal pure returns (bytes4) {
        return (bytes4(data[0]) | (bytes4(data[1]) >> 8) | (bytes4(data[2]) >> 16) | (bytes4(data[3]) >> 24));
    }

    function rescueETH() external {
        require(msg.sender == owner);
        (bool success, ) = msg.sender.call{ value: address(this).balance }('');
        require(success);
    }

    function rescueToken(address token) external {
        require(msg.sender == owner);
        (bool success, bytes memory err) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, IERC20(token).balanceOf(address(this)))
        );
        if (!success) parseRevertReason(err);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner);
        require(newOwner != address(0));
        owner = newOwner;
    }
}

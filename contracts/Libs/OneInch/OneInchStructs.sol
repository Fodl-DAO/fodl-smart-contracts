// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

library OneInchStructs {
    enum ActionType {
        UNKNOWN_ACTION,
        TRANSFER_ACTION,
        SAFE_TRANSFER_ACTION,
        SAFE_APPROVE_ACTION,
        V2_SWAP_ACTION,
        V3_SWAP_ACTION,
        RELATIVE_SINGLE_ACTION,
        RELATIVE_MULTI_ACTION,
        CRV_SWAP_EXCHANGE_ACTION,
        CRV_SWAP_EXCHANGE_UNDERLYING_ACTION,
        FINAL_CHECKS_ACTION
    }

    struct SwapDescription {
        address srcToken;
        address dstToken;
        address payable srcReceiver;
        address payable dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 flags;
        bytes permit;
    }

    struct Action {
        uint256 flagsAndCallTo;
        uint256 gasLimit;
        uint256 value;
        bytes payload;
    }

    struct CallBytes {
        Action[] actions;
    }

    // 0xb3af37c0
    struct RelativeSingleActionDescription {
        Action action;
        uint256 unknownArg0; // uint128, uint128
        address srcToken;
        uint256 unknownArg1; // uint128, uint128
    }

    // 0x83f1291f
    struct RelativeMultipleActionDescription {
        Action[] CrvSwapSubactionArgs;
        uint256[] unknownArray0;
        address srcToken;
        uint256 unknownArg0; // uint128, uint128
    }

    //////////////////////////////////////////////////
    //  Generic actions
    //////////////////////////////////////////////////

    // 0xa9059cbb = TransferAction
    struct TransferActionArgs {
        address to;
        uint256 amount;
    }

    // 0xd1660f99 = SafeTransferAction
    struct SafeTransferActionArgs {
        address token;
        address to;
        uint256 amount;
    }

    // 0xeb5625d9 = SafeApproveAction
    struct SafeApproveActionArgs {
        address token;
        address spender;
        uint256 amount;
    }

    //////////////////////////////////////////////////
    //  V2SwapAction
    //////////////////////////////////////////////////

    // 0xb757fed6
    struct V2SwapActionArgs {
        address pool;
        address srcToken;
        address dstToken;
        uint256 amountAndReceiver; // uint96 amount - maybe not amount, but fee! then addr receiver, tight packed
        uint256 unknownArg0;
    }

    //////////////////////////////////////////////////
    //  UnoswapAction
    //////////////////////////////////////////////////

    // 0x128acb08
    struct V3SwapActionArgs {
        address recipient;
        bool zeroForOne;
        uint256 exactInputMode;
        uint256 sqrtPriceLimit;
        bytes callbackdata; // uint256(token0) uint256(token1)
    }

    //////////////////////////////////////////////////
    //  CrvSwapAction
    //////////////////////////////////////////////////

    // 0x3df02124
    struct CrvSwapExchangeSubactionArgs {
        int128 i;
        int128 j;
        uint256 dx;
        uint256 minOutputAmount;
    }

    // 0xa6417ed6
    struct CrvSwapExchangeUnderlyingSubactionArgs {
        int128 i;
        int128 j;
        uint256 dx;
        uint256 minOutputAmount;
    }

    //////////////////////////////////////////////////
    //  Final checks action
    //////////////////////////////////////////////////

    // 0x7f8fe7a0
    struct FinalChecksActionArgs {
        Action action;
        uint256 flags;
        address recipient;
    }
}

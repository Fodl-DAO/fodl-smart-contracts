// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

library AaveFlashloanStorageLibV7 {
    bytes32 constant AAVE_FLASHLOAN_STORAGE_POSITION = keccak256('folding.storage.flashloan.aave');

    struct Storage {
        address expectedCallbackCaller;
        bool isPreview;
        bytes returnData;
    }

    function getStorage() internal pure returns (Storage storage s) {
        bytes32 position = AAVE_FLASHLOAN_STORAGE_POSITION;
        assembly {
            s.slot := position
        }
    }
}

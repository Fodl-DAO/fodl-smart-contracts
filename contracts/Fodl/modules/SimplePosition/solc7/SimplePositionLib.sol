// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

library SimplePositionLibV7 {
    bytes32 private constant SIMPLE_POSITION_STORAGE_LOCATION = keccak256('folding.simplePosition.storage');

    /**
     * platform:        address of the underlying platform (AAVE, COMPOUND, etc)
     *
     * supplyToken:     address of the token that is being supplied to the underlying platform
     *                  This token is also the principal token
     *
     * borrowToken:     address of the token that is being borrowed to leverage on supply token
     *
     * principalValue:  amount of supplyToken that user has invested in this position
     */
    struct Storage {
        address platform;
        address supplyToken;
        address borrowToken;
        uint256 principalValue;
    }

    function getStorage() internal pure returns (Storage storage s) {
        bytes32 position = SIMPLE_POSITION_STORAGE_LOCATION;
        assembly {
            s.slot := position
        }
    }

    function isSimplePosition() internal view returns (bool) {
        return getStorage().platform != address(0);
    }

    function requireSimplePositionDetails(
        address platform,
        address supplyToken,
        address borrowToken
    ) internal view {
        Storage storage s = getStorage();

        require(s.platform == platform, 'SP2');
        require(s.supplyToken == supplyToken, 'SP3');
        require(s.borrowToken == borrowToken, 'SP4');
    }
}

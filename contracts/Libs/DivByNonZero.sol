// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

library DivByNonZero {
    function divByNonZero(uint256 _num, uint256 _div) internal pure returns (uint256 result) {
        assembly {
            result := div(_num, _div)
        }
    }
}

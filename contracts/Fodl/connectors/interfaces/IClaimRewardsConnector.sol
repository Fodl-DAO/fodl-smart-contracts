// SPDX-License-Identifier: MIT

pragma solidity >=0.5.0 <0.9.0;

interface IClaimRewardsConnector {
    function claimRewards() external returns (address, uint256);
}

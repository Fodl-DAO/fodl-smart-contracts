// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

interface IOneInchOffchainOracle {
    /*
        WARNING!
        Usage of the dex oracle on chain is highly discouraged!
        getRate function can be easily manipulated inside transaction!
    */
    function getRate(
        address token,
        address refToken,
        bool useWrappers
    ) external view returns (uint256 weightedRate);

    function getRateWithCustomConnectors(
        address token,
        address refToken,
        bool useWrappers,
        address[] memory customConnectors
    ) external view returns (uint256 weightedRate);

    /// @dev Same as `getRate` but checks against `ETH` and `WETH` only
    function getRateToEth(address token, bool useSrcWrappers) external view returns (uint256 weightedRate);

    function getRateToEthWithCustomConnectors(
        address token,
        bool useSrcWrappers,
        address[] memory customConnectors
    ) external view returns (uint256 weightedRate);
}

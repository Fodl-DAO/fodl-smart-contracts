// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0;

interface IFundsManagerConnector {
    event FundsWithdrawal(uint256 withdrawAmount, uint256 principalFactor);

    function addPrincipal(uint256 amount) external;

    function withdraw(uint256 amount, uint256 positionValue)
        external
        returns (
            uint256 principalShare,
            uint256 profitShare,
            uint256 subsidy
        );
}

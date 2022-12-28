// SPDX-License-Identifier
pragma solidity >=0.5.0 <0.9.0;

interface ICRV {
    function minter() external view returns (address);

    function mint(address to, uint256 amount) external returns (bool);
}

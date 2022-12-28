import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { AAVE_PLATFORM_POLYGON } from '../../constants/deploy'
import { overrideAavePriceOracle } from '../../test/shared/utils'
import { AavePriceOracleMock, IAaveLendingPoolProvider__factory } from '../../typechain'
import { deployContract } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // This script should only be run for dev/sit/test networks
  if ((await hre.getChainId()) == '137') return

  await deployContract(hre, 'AavePriceOracleMock', [])

  const aavePriceOracleMock = (await hre.ethers.getContract('AavePriceOracleMock')) as AavePriceOracleMock

  const aave = IAaveLendingPoolProvider__factory.connect(AAVE_PLATFORM_POLYGON, ethers.provider)
  await aavePriceOracleMock.setOriginalOracle(await aave.callStatic.getPriceOracle())

  await overrideAavePriceOracle(AAVE_PLATFORM_POLYGON, aavePriceOracleMock.address)
}

export default func
func.tags = ['MockPrices']

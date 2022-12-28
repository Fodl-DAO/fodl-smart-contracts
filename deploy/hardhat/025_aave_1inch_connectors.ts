import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import {
  AAVE_PLATFORM,
  AAVE_PLATFORM_DATA_PROVIDER,
  AAVE_PLATFORM_INCENTIVES_CONTROLLER,
  ONE_INCH_EXCHANGE,
} from '../../constants/deploy'
import { FoldingRegistry } from '../../typechain'
import { deployConnector } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const foldingRegistry = (await hre.ethers.getContract('FoldingRegistry')) as FoldingRegistry

  const args = [AAVE_PLATFORM, AAVE_PLATFORM_DATA_PROVIDER, AAVE_PLATFORM_INCENTIVES_CONTROLLER, ONE_INCH_EXCHANGE]
  await deployConnector(hre, foldingRegistry, 'AavePositionIncreaseConnector', 'IAavePositionIncreaseConnector', args)
  await deployConnector(hre, foldingRegistry, 'AavePositionDecreaseConnector', 'IAavePositionDecreaseConnector', args)
}

export default func
func.tags = ['AaveOneInchConnectors']
func.dependencies = ['FoldingRegistry']

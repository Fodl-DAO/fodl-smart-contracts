import { FACTORY_ADDRESS } from '@uniswap/v3-sdk'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import {
  SUBSIDY_HOLDER_ADDRESS_POLYGON,
  SUBSIDY_PRINCIPAL,
  SUBSIDY_PROFIT,
  SUBSIDY_REWARDS,
} from '../../constants/deploy'
import { FoldingRegistry } from '../../typechain'
import { deployConnector } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const registry = (await hre.ethers.getContract('FoldingRegistry')) as FoldingRegistry

  await deployConnector(
    hre,
    registry,
    'IncreaseWithV3FlashswapMultihopConnector',
    'IIncreaseWithV3FlashswapMultihopConnector',
    [SUBSIDY_PRINCIPAL, SUBSIDY_PROFIT, SUBSIDY_HOLDER_ADDRESS_POLYGON, FACTORY_ADDRESS]
  )

  await deployConnector(
    hre,
    registry,
    'DecreaseWithV3FlashswapMultihopConnector',
    'IDecreaseWithV3FlashswapMultihopConnector',
    [SUBSIDY_PRINCIPAL, SUBSIDY_PROFIT, SUBSIDY_REWARDS, SUBSIDY_HOLDER_ADDRESS_POLYGON, FACTORY_ADDRESS]
  )
}

export default func
func.tags = ['FlashswapConnectors']

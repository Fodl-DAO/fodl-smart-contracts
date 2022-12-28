import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import {
  PANCAKE_FACTORY,
  SUBSIDY_HOLDER_ADDRESS_BSC,
  SUBSIDY_PRINCIPAL,
  SUBSIDY_PROFIT,
  SUBSIDY_REWARDS,
} from '../../constants/deploy'
import { FodlNFT, FoldingRegistry } from '../../typechain'
import { deployConnector } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const foldingRegistry = (await hre.ethers.getContract('FoldingRegistry')) as FoldingRegistry

  await deployConnector(hre, foldingRegistry, 'FlashswapConnectorBSC', 'IFlashswapConnectorBSC', [
    SUBSIDY_PRINCIPAL,
    SUBSIDY_PROFIT,
    SUBSIDY_REWARDS,
    SUBSIDY_HOLDER_ADDRESS_BSC,
    PANCAKE_FACTORY,
  ])
}

export default func
func.tags = ['FlashswapConnector']

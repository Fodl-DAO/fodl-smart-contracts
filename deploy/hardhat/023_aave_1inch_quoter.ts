import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { AAVE_PLATFORM, ONE_INCH_EXCHANGE } from '../../constants/deploy'
import { deployContract } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  await deployContract(hre, 'AaveOneInchQuoter', [AAVE_PLATFORM, ONE_INCH_EXCHANGE])
}

export default func
func.tags = ['Aave1InchQuoter']

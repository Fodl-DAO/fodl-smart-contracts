import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { SUBSIDY_HOLDER_ADDRESS_MAINNET, SUBSIDY_PRINCIPAL, SUBSIDY_PROFIT } from '../../constants/deploy'
import { FoldingRegistry } from '../../typechain'
import { deployConnector } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const foldingRegistry = (await hre.ethers.getContract('FoldingRegistry')) as FoldingRegistry

  const args = [SUBSIDY_PRINCIPAL, SUBSIDY_PROFIT, SUBSIDY_HOLDER_ADDRESS_MAINNET]
  await deployConnector(hre, foldingRegistry, 'FundsManagerConnector', 'IFundsManagerConnector', args)
}

export default func
func.tags = ['FundsManagerConnector']
func.dependencies = ['FoldingRegistry']

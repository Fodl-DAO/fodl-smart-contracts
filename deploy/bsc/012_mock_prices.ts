import { ethers } from 'hardhat'
import { DeployFunction } from 'hardhat-deploy/types'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { VENUS_PLATFORM } from '../../constants/deploy'
import { overrideCompoundPriceOracle } from '../../test/shared/utils'
import { CompoundPriceOracleMock, IComptroller__factory } from '../../typechain'
import { deployContract } from '../../utils/deploy'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // This script should only be run for dev/sit/test networks
  if ((await hre.getChainId()) == '56') return

  await deployContract(hre, 'CompoundPriceOracleMock', [])
  const compoundPriceOracleMock = (await hre.ethers.getContract('CompoundPriceOracleMock')) as CompoundPriceOracleMock

  const comptroller = IComptroller__factory.connect(VENUS_PLATFORM, ethers.provider)
  await compoundPriceOracleMock.setOriginalOracle(await comptroller.callStatic.oracle())
  await overrideCompoundPriceOracle(VENUS_PLATFORM, compoundPriceOracleMock.address)
}

export default func
func.tags = ['MockPrices']
func.dependencies = ['FoldingRegistry']

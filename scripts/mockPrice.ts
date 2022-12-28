import dotenv from 'dotenv'
import { parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import {
  AAVE_PLATFORM,
  AAVE_PLATFORM_POLYGON,
  COMPOUND_PLATFORM,
  COMPOUND_TOKENS_TO_CTOKENS,
} from '../constants/deploy'
import {
  AavePriceOracleMock,
  CompoundPriceOracleMock,
  IAaveLendingPoolProvider__factory,
  IComptroller__factory,
} from '../typechain'

dotenv.config()

const token = process.env.TOKEN || 'This token address is invalid'
const priceChange = process.env.PRICE || '1'
const chain = process.env.CHAIN?.toUpperCase() || 'ETHEREUM'

export const mockPrice = async () => {
  switch (chain) {
    case 'ETHEREUM':
      await mockAavePrice(AAVE_PLATFORM)
      await mockCompoundPrice(COMPOUND_PLATFORM)
      break
    case 'POLYGON':
      await mockAavePrice(AAVE_PLATFORM_POLYGON)
      break
    default:
      throw Error('Chain env not recognised')
  }
}

const mockAavePrice = async (platform: string) => {
  const aave = IAaveLendingPoolProvider__factory.connect(platform, ethers.provider)
  const aavePriceOracleMock = (await ethers.getContractAt(
    'AavePriceOracleMock',
    await aave.callStatic.getPriceOracle()
  )) as AavePriceOracleMock

  const priceUpdate = parseEther(priceChange)
  await aavePriceOracleMock.setPriceUpdate(token, priceUpdate)
}

export const mockCompoundPrice = async (platform: string) => {
  const comptroller = IComptroller__factory.connect(platform, ethers.provider)
  const compoundPriceOracleMock = (await ethers.getContractAt(
    'CompoundPriceOracleMock',
    await comptroller.callStatic.oracle()
  )) as CompoundPriceOracleMock

  const priceUpdate = parseEther(priceChange)
  await compoundPriceOracleMock.setPriceUpdate(COMPOUND_TOKENS_TO_CTOKENS[token], priceUpdate)
}

mockPrice().catch(console.error)

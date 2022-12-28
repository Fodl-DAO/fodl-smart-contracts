import { ChainId } from '@sushiswap/sdk'
import { expect } from 'chai'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'
import { SignerWithAddress } from 'hardhat-deploy-ethers/signers'
import { AAVE_PLATFORM, ONE_INCH_SPOT_PRICE_ORACLES } from '../constants/deploy'
import { USDC, WETH } from '../constants/tokens'
import { sendToken } from '../scripts/utils'
import {
  AaveOneInchQuoter,
  AavePriceOracleMock,
  AllConnectors,
  IFlashLoanReceiver__factory,
  IOneInchOffchainOracle__factory,
  LendingPlatformLens,
} from '../typechain'
import { recodeOneInchQuote } from '../utils/recodeOneInchQuote'
import { MANTISSA } from './shared/constants'
import { simplePositionFixture } from './shared/fixtures'
import { ONE_INCH_USDC_TO_WETH_RESPONSE, ONE_INCH_USDC_TO_WETH_UNOSWAP_RESPONSE } from './shared/OneInchResponses'
import { convertPrice } from './shared/utils'

describe('AavePositionIncreaseConnector', () => {
  const platform = AAVE_PLATFORM
  const chainId = ChainId.MAINNET
  const spotPriceOracle = IOneInchOffchainOracle__factory.connect(ONE_INCH_SPOT_PRICE_ORACLES[chainId], ethers.provider)

  const supplyToken = WETH
  const borrowToken = USDC

  const principalAmount = 300
  const principalAmountBN = parseUnits(`${principalAmount}`, supplyToken.decimals)
  const leverage = 3
  const slippage = 0.2 // 20% of slippage
  const slippageBN = parseUnits(`${slippage}`, 18)

  let alice: SignerWithAddress
  let mallory: SignerWithAddress

  let account: AllConnectors
  let quoter: AaveOneInchQuoter
  let aavePriceOracleMock: AavePriceOracleMock
  let lendingLens: LendingPlatformLens

  let price = 0 // units: supplyToken / borrowToken

  const fixture = deployments.createFixture(async (hre) => {
    const fixt = await simplePositionFixture()
    const quoter = (await hre.ethers.getContract('AaveOneInchQuoter')) as AaveOneInchQuoter

    const price = await spotPriceOracle
      .getRate(borrowToken.address, supplyToken.address, false)
      .then((priceBN) => convertPrice(priceBN, borrowToken.decimals, supplyToken.decimals) as number)

    const lendingLens = (await hre.ethers.getContract('LendingPlatformLens')) as LendingPlatformLens

    await sendToken(supplyToken, fixt.alice.address, principalAmount * 100)
    await supplyToken.contract.connect(fixt.alice).approve(fixt.account.address, ethers.constants.MaxUint256)
    await borrowToken.contract.connect(fixt.alice).approve(fixt.account.address, ethers.constants.MaxUint256)

    return { ...fixt, quoter, price, lendingLens }
  })

  beforeEach('load fixture', async () => {
    ;({ alice, mallory, account, price, quoter, aavePriceOracleMock, lendingLens } = await fixture())
  })

  describe('aavePosition_Increase', () => {
    describe('when supply token != borrow token', () => {
      it('can open a position with high volume', async () => {
        const flashloanAmount = principalAmount * (leverage - 1)
        const borrowAmount = flashloanAmount / price
        const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

        const { modifiedPayloadWithSelector: oneInchTxData } = recodeOneInchQuote(
          ONE_INCH_USDC_TO_WETH_RESPONSE,
          borrowAmountBN,
          account.address
        )

        const leveragedSupplyAmountBN = await quoter.connect(alice).callStatic.quote(borrowAmountBN, oneInchTxData)
        const expectedSupplyAmountBN = principalAmountBN.add(leveragedSupplyAmountBN)
        const minSupplyAmountBN = expectedSupplyAmountBN.sub(leveragedSupplyAmountBN.mul(slippageBN).div(MANTISSA))

        const { supply, borrow } = await account
          .connect(alice)
          .callStatic.aavePosition_IncreasePreview(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )

        expect(supply).to.be.gte(minSupplyAmountBN)
        expect(borrow).to.be.eq(borrowAmountBN)

        await account
          .connect(alice)
          .aavePosition_Increase(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )

        // Check position has been correctly opened
        expect(await account.callStatic.getSupplyBalance()).to.be.gte(minSupplyAmountBN)
        expect(await account.callStatic.getBorrowBalance()).to.be.closeTo(borrowAmountBN, borrowAmountBN.div(100))

        // Check no leftovers in contract
        for (const token of [supplyToken, borrowToken])
          expect(await token.contract.connect(ethers.provider).balanceOf(account.address)).to.be.equal(0)
      })

      it('can open a position with low volume (unoswap)', async () => {
        const principalAmount = 1
        const principalAmountBN = parseUnits(`${principalAmount}`, supplyToken.decimals)
        const flashloanAmount = principalAmount * (leverage - 1)
        const borrowAmount = flashloanAmount / price
        const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

        const { modifiedPayloadWithSelector: oneInchTxData } = recodeOneInchQuote(
          ONE_INCH_USDC_TO_WETH_UNOSWAP_RESPONSE,
          borrowAmountBN,
          account.address
        )

        const leveragedSupplyAmountBN = await quoter.connect(alice).callStatic.quote(borrowAmountBN, oneInchTxData)
        const expectedSupplyAmountBN = principalAmountBN.add(leveragedSupplyAmountBN)
        const minSupplyAmountBN = expectedSupplyAmountBN.sub(leveragedSupplyAmountBN.mul(slippageBN).div(MANTISSA))

        const { supply, borrow } = await account
          .connect(alice)
          .callStatic.aavePosition_IncreasePreview(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )

        expect(supply).to.be.gte(minSupplyAmountBN)
        expect(borrow).to.be.eq(borrowAmountBN)

        await account
          .connect(alice)
          .aavePosition_Increase(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )

        // Check position has been correctly opened
        expect(await account.callStatic.getSupplyBalance()).to.be.gte(minSupplyAmountBN)
        expect(await account.callStatic.getBorrowBalance()).to.be.gte(borrowAmountBN)

        // Check no leftovers in contract
        for (const token of [supplyToken, borrowToken])
          expect(await token.contract.connect(ethers.provider).balanceOf(account.address)).to.be.equal(0)
      })

      it('can add principal, works with bad debt  ', async () => {
        const borrowAmount = (0.6 * principalAmount) / price
        const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

        await account.increaseSimplePositionWithFunds(
          platform,
          supplyToken.address,
          principalAmountBN,
          borrowToken.address,
          borrowAmountBN
        )

        await aavePriceOracleMock.setPriceUpdate(supplyToken.address, MANTISSA.div(50))

        const collateralUsageFactor = await account.callStatic.getCollateralUsageFactor()
        expect(collateralUsageFactor).to.be.gt(MANTISSA)

        await account.aavePosition_Increase(
          platform,
          supplyToken.address,
          principalAmountBN,
          principalAmountBN,
          borrowToken.address,
          0,
          '0x00'
        )
      })
      it('works after being liquidated via PNL', async () => {
        const flashloanAmount = principalAmount * (leverage - 1)
        const borrowAmount = flashloanAmount / price
        const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

        const { modifiedPayloadWithSelector: oneInchTxData } = recodeOneInchQuote(
          ONE_INCH_USDC_TO_WETH_RESPONSE,
          borrowAmountBN,
          account.address
        )

        const leveragedSupplyAmountBN = await quoter.connect(alice).callStatic.quote(borrowAmountBN, oneInchTxData)
        const expectedSupplyAmountBN = principalAmountBN.add(leveragedSupplyAmountBN)
        const minSupplyAmountBN = expectedSupplyAmountBN.sub(leveragedSupplyAmountBN.mul(slippageBN).div(MANTISSA))

        await account
          .connect(alice)
          .aavePosition_Increase(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )

        const [{ referencePrice: ethPrice }, { referencePrice: usdcPrice }] =
          await lendingLens.callStatic.getAssetMetadata(
            [platform, platform],
            [supplyToken.address, borrowToken.address]
          )

        const currentPriceRatio = ethPrice.mul(MANTISSA).div(usdcPrice)

        await account.configurePNL(currentPriceRatio.add(1), principalAmountBN.div(2), 0, MANTISSA, true)
        await aavePriceOracleMock.setPriceUpdate(supplyToken.address, parseEther('2'))

        const repayAmount = borrowAmount * 1.05
        await sendToken(borrowToken, alice.address, repayAmount)
        await borrowToken.contract
          .connect(alice)
          .transfer(account.address, parseUnits(`${repayAmount.toFixed(borrowToken.decimals)}`, borrowToken.decimals))
        await account.connect(alice).executePNL(0, false)

        await account
          .connect(alice)
          .aavePosition_Increase(
            platform,
            supplyToken.address,
            principalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowAmountBN,
            oneInchTxData
          )
      })
    })

    describe('when supply token == borrow token', () => {
      it('can open and add principal to a position', async () => {
        const flashloanAmount = principalAmount * (leverage - 1)
        const flashloanAmountBN = parseUnits(flashloanAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

        await account
          .connect(alice)
          .aavePosition_Increase(
            platform,
            supplyToken.address,
            principalAmountBN,
            0,
            supplyToken.address,
            flashloanAmountBN,
            '0x00'
          )

        const collateralUsageFactor = await account.callStatic.getCollateralUsageFactor()
        expect(collateralUsageFactor).to.be.gt(0)
        expect(await account.callStatic.getSupplyBalance()).to.be.gte(principalAmountBN.add(flashloanAmountBN))

        await account
          .connect(alice)
          .aavePosition_Increase(platform, supplyToken.address, principalAmountBN, 0, supplyToken.address, 0, '0x00')

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.lt(collateralUsageFactor)
        expect(await account.callStatic.getSupplyBalance()).to.be.gte(principalAmountBN.add(flashloanAmountBN))

        await account
          .connect(alice)
          .aavePosition_Increase(platform, supplyToken.address, 0, 0, supplyToken.address, flashloanAmountBN, '0x00')

        expect(await account.callStatic.getSupplyBalance()).to.be.gte(principalAmountBN.add(flashloanAmountBN).mul(2))
      })
    })
  })

  describe('aavePosition_IncreasePreview', () => {
    it('correctly returns expected values', async () => {
      const flashloanAmount = principalAmount * (leverage - 1)
      const borrowAmount = flashloanAmount / price
      const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

      const { modifiedPayloadWithSelector: oneInchTxData } = recodeOneInchQuote(
        ONE_INCH_USDC_TO_WETH_RESPONSE,
        borrowAmountBN,
        account.address
      )

      const leveragedSupplyAmountBN = await quoter.connect(alice).callStatic.quote(borrowAmountBN, oneInchTxData)
      const expectedSupplyAmountBN = principalAmountBN.add(leveragedSupplyAmountBN)
      const minSupplyAmountBN = expectedSupplyAmountBN.sub(leveragedSupplyAmountBN.mul(slippageBN).div(MANTISSA))

      const { supply, borrow, inputAmount, outputAmount } = await account
        .connect(alice)
        .callStatic.aavePosition_IncreasePreview(
          platform,
          supplyToken.address,
          principalAmountBN,
          minSupplyAmountBN,
          borrowToken.address,
          borrowAmountBN,
          oneInchTxData
        )

      expect(supply).to.be.gte(minSupplyAmountBN)
      expect(outputAmount).to.be.eq(leveragedSupplyAmountBN)
      expect(borrow).to.be.eq(borrowAmountBN)
      expect(borrow).to.be.eq(inputAmount)
    })
  })

  describe('executeOperation', () => {
    it('cannot be called by external addresses', async () => {
      const _account = IFlashLoanReceiver__factory.connect(account.address, mallory)
      await expect(_account.executeOperation([], [], [], alice.address, '0x00')).to.be.revertedWith('FR2')
    })
  })
})

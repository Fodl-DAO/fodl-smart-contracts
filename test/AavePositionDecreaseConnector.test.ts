import { BigNumber } from '@ethersproject/bignumber'
import { parseUnits } from '@ethersproject/units'
import { ChainId } from '@sushiswap/sdk'
import { expect } from 'chai'
import { formatUnits } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'
import { SignerWithAddress } from 'hardhat-deploy-ethers/signers'
import { cloneDeep } from 'lodash'
import { AAVE_PLATFORM, ONE_INCH_SPOT_PRICE_ORACLES } from '../constants/deploy'
import { USDC, WETH } from '../constants/tokens'
import { sendToken } from '../scripts/utils'
import {
  AaveOneInchQuoter,
  AavePriceOracleMock,
  AllConnectors,
  AllConnectors__factory,
  FoldingRegistry,
  FundsManagerConnector,
  IOneInchOffchainOracle__factory,
  LendingPlatformLens,
} from '../typechain'
import { recodeOneInchQuote } from '../utils/recodeOneInchQuote'
import { reverseExactInQuote } from '../utils/reverseExactInQuote'
import { MANTISSA } from './shared/constants'
import { simplePositionFixture } from './shared/fixtures'
import { ONE_INCH_WETH_TO_USDC } from './shared/OneInchResponses'
import { convertPrice, solidityTokenAmount2Float } from './shared/utils'

describe('AavePositionDecreaseConnector', () => {
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
  let fundsManager: FundsManagerConnector
  let foldingRegistry: FoldingRegistry

  let price = 0

  const fixture = deployments.createFixture(async (hre) => {
    const fixt = await simplePositionFixture()
    const quoter = (await hre.ethers.getContract('AaveOneInchQuoter')).connect(fixt.alice) as AaveOneInchQuoter

    const price = await spotPriceOracle
      .getRate(borrowToken.address, supplyToken.address, false)
      .then((priceBN) => convertPrice(priceBN, borrowToken.decimals, supplyToken.decimals) as number)

    const lendingLens = (await hre.ethers.getContract('LendingPlatformLens')) as LendingPlatformLens
    const fundsManager = (await hre.ethers.getContract('FundsManagerConnector')) as FundsManagerConnector

    await sendToken(supplyToken, fixt.alice.address, principalAmount * 100)
    await supplyToken.contract.connect(fixt.alice).approve(fixt.account.address, ethers.constants.MaxUint256)
    await borrowToken.contract.connect(fixt.alice).approve(fixt.account.address, ethers.constants.MaxUint256)

    const borrowAmount = (leverage * principalAmount) / price
    const supplyAmount = (leverage + 1) * principalAmount
    const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)
    const supplyAmountBN = parseUnits(supplyAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

    await fixt.account.increaseSimplePositionWithFunds(
      platform,
      supplyToken.address,
      supplyAmountBN,
      borrowToken.address,
      borrowAmountBN
    )

    return { ...fixt, quoter, price, lendingLens, fundsManager }
  })

  beforeEach('load fixture', async () => {
    ;({ alice, mallory, account, price, quoter, aavePriceOracleMock, lendingLens, fundsManager, foldingRegistry } =
      await fixture())
  })

  describe('aavePosition_Decrease', () => {
    describe('when supply token != borrow token', () => {
      it('can close a position with high volume', async () => {
        const baseOneInchArtifact = ONE_INCH_WETH_TO_USDC

        const supplyBalance = await account.callStatic.getSupplyBalance()
        const debtBN = await account.callStatic.getBorrowBalance()
        const debt = solidityTokenAmount2Float(borrowToken, debtBN)
        let baseRedeemAmount = debt * price
        let baseRedeemAmountBN = parseUnits(baseRedeemAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

        baseRedeemAmountBN = (await reverseExactInQuote(baseRedeemAmountBN, debtBN, quoter, baseOneInchArtifact))
          .amountIn

        let finalMaxRedeemAmountBN = baseRedeemAmountBN.add(baseRedeemAmountBN.mul(slippageBN).div(MANTISSA))
        if (finalMaxRedeemAmountBN.gt(supplyBalance)) finalMaxRedeemAmountBN = supplyBalance

        const finalOneInchTxData = recodeOneInchQuote(
          baseOneInchArtifact,
          finalMaxRedeemAmountBN,
          account.address
        ).modifiedPayloadWithSelector

        await account.aavePosition_Decrease(
          platform,
          supplyToken.address,
          ethers.constants.MaxUint256,
          finalMaxRedeemAmountBN,
          borrowToken.address,
          ethers.constants.MaxUint256,
          finalOneInchTxData
        )

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.eq(0)

        // Check no leftovers in contract
        for (const token of [supplyToken, borrowToken])
          expect(await token.contract.connect(ethers.provider).balanceOf(account.address)).to.be.equal(0)
      })

      it('can withdraw in profit', async () => {
        const priceIncrease = parseUnits('1.1')
        await aavePriceOracleMock.setPriceUpdate(supplyToken.address, priceIncrease)
        const taxAddress = await fundsManager.holder()

        const withdrawAmountBN = parseUnits((principalAmount / 100).toFixed(supplyToken.decimals), supplyToken.decimals)

        const receipt = await account
          .aavePosition_Decrease(platform, supplyToken.address, withdrawAmountBN, 0, borrowToken.address, 0, '0x00')
          .then((tx) => tx.wait())

        // Extract address from event
        const filter = supplyToken.contract.filters.Transfer(account.address)
        const transfers = await supplyToken.contract.connect(ethers.provider).queryFilter(filter, receipt.blockHash)

        const withdrawTransfer = transfers.filter((t) => t.args.to.toLowerCase() === alice.address.toLowerCase())
        const taxTransfer = transfers.filter((t) => t.args.to.toLowerCase() === taxAddress.toLowerCase())

        expect(withdrawTransfer).to.have.length(1)
        expect(taxTransfer).to.have.length(1)
      })

      // Pure withdraw not supported by UI
      it.skip('can withdraw in loss', async () => {
        const taxAddress = await fundsManager.holder()
        const principalTax = await fundsManager.principal()

        const withdrawAmountBN = parseUnits((principalAmount / 100).toFixed(supplyToken.decimals), supplyToken.decimals)
        const expectedTaxedAmountBN = withdrawAmountBN.mul(principalTax).div(MANTISSA)
        const expectedWithdrawnAmountBN = withdrawAmountBN.sub(expectedTaxedAmountBN)

        const receipt = await account
          .aavePosition_Decrease(platform, supplyToken.address, withdrawAmountBN, 0, borrowToken.address, 0, '0x00')
          .then((tx) => tx.wait())

        // Extract address from event
        const filter = supplyToken.contract.filters.Transfer(account.address)
        const transfers = await supplyToken.contract.connect(ethers.provider).queryFilter(filter, receipt.blockHash)

        const withdrawTransfer = transfers.filter((t) => t.args.to.toLowerCase() === alice.address.toLowerCase())[0]
        const taxTransfer = transfers.filter((t) => t.args.to.toLowerCase() === taxAddress.toLowerCase())[0]

        const errorToleranceWei = parseUnits('100', 'gwei')
        expect(withdrawTransfer.args.value).to.be.closeTo(expectedWithdrawnAmountBN, errorToleranceWei)
        expect(taxTransfer.args.value).to.be.closeTo(expectedTaxedAmountBN, errorToleranceWei)
      })

      it('can decrease leverage (partially close position)', async () => {
        const baseOneInchArtifact = ONE_INCH_WETH_TO_USDC

        const initialCollateralFactor = await account.callStatic.getCollateralUsageFactor()
        const supplyBalance = await account.callStatic.getSupplyBalance()
        const debtToRepay = await account.callStatic.getBorrowBalance().then((debt) => debt.div(2))
        const debt = solidityTokenAmount2Float(borrowToken, debtToRepay)
        let baseRedeemAmount = debt * price
        let baseRedeemAmountBN = parseUnits(baseRedeemAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

        baseRedeemAmountBN = (await reverseExactInQuote(baseRedeemAmountBN, debtToRepay, quoter, baseOneInchArtifact))
          .amountIn

        let finalMaxRedeemAmountBN = baseRedeemAmountBN.add(baseRedeemAmountBN.mul(slippageBN).div(MANTISSA))
        if (finalMaxRedeemAmountBN.gt(supplyBalance)) finalMaxRedeemAmountBN = supplyBalance

        const finalOneInchTxData = recodeOneInchQuote(
          baseOneInchArtifact,
          finalMaxRedeemAmountBN,
          account.address
        ).modifiedPayloadWithSelector

        await account.aavePosition_Decrease(
          platform,
          supplyToken.address,
          0,
          finalMaxRedeemAmountBN,
          borrowToken.address,
          debtToRepay,
          finalOneInchTxData
        )

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.lt(initialCollateralFactor)
      })

      it('can close with bad debt', async () => {
        const priceDecrease = parseUnits('0.1')
        await aavePriceOracleMock.setPriceUpdate(supplyToken.address, priceDecrease)

        const baseOneInchArtifact = ONE_INCH_WETH_TO_USDC

        const supplyBalance = await account.callStatic.getSupplyBalance()
        const debtBN = await account.callStatic.getBorrowBalance()
        const debt = solidityTokenAmount2Float(borrowToken, debtBN)
        let baseRedeemAmount = debt * price
        let baseRedeemAmountBN = parseUnits(baseRedeemAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

        baseRedeemAmountBN = (await reverseExactInQuote(baseRedeemAmountBN, debtBN, quoter, baseOneInchArtifact))
          .amountIn

        let finalMaxRedeemAmountBN = baseRedeemAmountBN.add(baseRedeemAmountBN.mul(slippageBN).div(MANTISSA))
        if (finalMaxRedeemAmountBN.gt(supplyBalance)) finalMaxRedeemAmountBN = supplyBalance

        const finalOneInchTxData = recodeOneInchQuote(
          baseOneInchArtifact,
          finalMaxRedeemAmountBN,
          account.address
        ).modifiedPayloadWithSelector

        await account.aavePosition_Decrease(
          platform,
          supplyToken.address,
          ethers.constants.MaxUint256,
          finalMaxRedeemAmountBN,
          borrowToken.address,
          ethers.constants.MaxUint256,
          finalOneInchTxData
        )

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.eq(0)
      })

      it('works after being liquidated via PNL', async () => {
        const [{ referencePrice: ethPrice }, { referencePrice: usdcPrice }] =
          await lendingLens.callStatic.getAssetMetadata(
            [platform, platform],
            [supplyToken.address, borrowToken.address]
          )

        const currentPriceRatio = ethPrice.mul(MANTISSA).div(usdcPrice)
        await account.configurePNL(currentPriceRatio.add(1), principalAmountBN.div(2), 0, MANTISSA, true)
        await aavePriceOracleMock.setPriceUpdate(supplyToken.address, parseUnits('2'))

        const repayAmountBN = await account.callStatic.getBorrowBalance().then((debt) => debt.mul(105).div(100))
        await sendToken(borrowToken, alice.address, repayAmountBN)
        await borrowToken.contract.connect(alice).transfer(account.address, repayAmountBN)
        await account.connect(alice).executePNL(0, false)

        await account
          .connect(alice)
          .aavePosition_Decrease(
            platform,
            supplyToken.address,
            ethers.constants.MaxUint256,
            0,
            borrowToken.address,
            0,
            '0x00'
          )

        expect(await account.callStatic.getSupplyBalance()).to.be.eq(0)
      })
    })

    describe('when supply token == borrow token', async () => {
      it('can decrease leverage and close the position', async () => {
        const account = await foldingRegistry
          .connect(alice)
          .callStatic.createAccount()
          .then((addr) => AllConnectors__factory.connect(addr, alice))
        await foldingRegistry.connect(alice).createAccount()

        await supplyToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)

        const noExchangeData = []
        const flashloanAmount = principalAmount * (leverage - 1)
        const flashloanAmountBN = parseUnits(flashloanAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

        await account.aavePosition_Increase(
          platform,
          supplyToken.address,
          principalAmountBN,
          0,
          supplyToken.address,
          flashloanAmountBN,
          noExchangeData
        )

        const getCollateralUsageFactor = account.connect(alice).callStatic.getCollateralUsageFactor
        const collateralUsageFactorAtOpen = await getCollateralUsageFactor()

        await account.aavePosition_Decrease(
          platform,
          supplyToken.address,
          0,
          0,
          supplyToken.address,
          flashloanAmountBN,
          noExchangeData
        )

        expect(await getCollateralUsageFactor()).to.be.lt(collateralUsageFactorAtOpen)

        await account.aavePosition_Decrease(
          platform,
          supplyToken.address,
          ethers.constants.MaxUint256,
          0,
          supplyToken.address,
          ethers.constants.MaxUint256,
          noExchangeData
        )
        expect(await getCollateralUsageFactor()).to.be.eq(0)
      })
    })
  })

  describe('aavePosition_DecreasePreview', () => {
    it('correctly returns expected values')
  })
})

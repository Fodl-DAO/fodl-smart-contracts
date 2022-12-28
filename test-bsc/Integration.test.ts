import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MaxUint256 } from '@uniswap/sdk-core'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { cloneDeep } from 'lodash'
import { PANCAKE_ROUTER, USE_PANCAKESWAP_EXCHANGE, VENUS_PLATFORM, VENUS_TOKENS_TO_VTOKENS } from '../constants/deploy'
import { BSCDAI, BSCETH, BSCUSDC, BSCUSDT, BTCB, BUSD, TokenData, WBNB } from '../constants/tokens'
import { sendToken } from '../scripts/utils'
import { MANTISSA } from '../test/shared/constants'
import { CHAIN_ID, findBestRoute, PROTOCOL } from '../test/shared/routeFinder'
import { float2SolidityTokenAmount, solidityTokenAmount2Float } from '../test/shared/utils'
import {
  AllConnectorsBSC,
  AllConnectorsBSC__factory,
  CompoundPriceOracleMock,
  CompoundPriceOracleMock__factory,
  FodlNFT,
  FodlNFT__factory,
  FoldingRegistry,
  FoldingRegistry__factory,
  ICToken__factory,
  LendingPlatformLens,
  LendingPlatformLens__factory,
  PancakeswapRouter,
  PancakeswapRouter__factory,
} from '../typechain'

const BNB_PRINCIPAL_AMOUNT = 1_000
const BTC_PRINCIPAL_AMOUNT = 10
const USD_PRINCIPAL_AMOUNT = 100_000

const MAX_DEVIATION = 0.4

const PANCAKESWAP_FEE_NUMERATOR = 99750
const PANCAKESWAP_FEE_DENOMINATOR = 100000
describe('Integration', () => {
  const inVenus = {
    platform: VENUS_PLATFORM,
    platformName: 'VENUS',
  }

  // Max leverage for a coin: CF / (1-CF) where CF = Collateral Factor
  interface ITEST_TABLE {
    platformName: string
    platform: string
    principalToken: TokenData
    borrowToken: TokenData
    principalAmount: number
    leverage: number
  }

  const TESTS_TABLE_TRADE: ITEST_TABLE[] = [
    // Venus test cases
    { ...inVenus, principalToken: WBNB, borrowToken: BSCUSDT, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: WBNB, borrowToken: BSCUSDC, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: WBNB, borrowToken: BSCDAI, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: WBNB, borrowToken: BTCB, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: WBNB, borrowToken: BUSD, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BTCB, borrowToken: BSCUSDT, principalAmount: BTC_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BTCB, borrowToken: BSCUSDC, principalAmount: BTC_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BTCB, borrowToken: BSCDAI, principalAmount: BTC_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BTCB, borrowToken: WBNB, principalAmount: BTC_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BTCB, borrowToken: BUSD, principalAmount: BTC_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BUSD, borrowToken: BSCUSDT, principalAmount: USD_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BUSD, borrowToken: BSCUSDC, principalAmount: USD_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BUSD, borrowToken: BSCDAI, principalAmount: USD_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BUSD, borrowToken: BTCB, principalAmount: USD_PRINCIPAL_AMOUNT, leverage: 2 },
    { ...inVenus, principalToken: BUSD, borrowToken: WBNB, principalAmount: USD_PRINCIPAL_AMOUNT, leverage: 2 },
    /**
     * XVS gives troubles due to borrow cap
     */
    // { ...inVenus, principalToken: WBNB, borrowToken: XVS, principalAmount: 10, leverage: 1.2 },
    // { ...inVenus, principalToken: BUSD, borrowToken: XVS, principalAmount: 10, leverage: 2 },
    // { ...inVenus, principalToken: BTCB, borrowToken: XVS, principalAmount: 10, leverage: 2 },
    // { ...inVenus, principalToken: BSCDAI, borrowToken: XVS, principalAmount: 10, leverage: 2 },
  ]

  const TESTS_TABLE_FARM = [
    { ...inVenus, token: WBNB, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 1.2 },
    { ...inVenus, token: BTCB, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 1.2 },
    { ...inVenus, token: BSCDAI, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 1.2 },
    { ...inVenus, token: BSCUSDC, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 1.2 },
    { ...inVenus, token: BSCETH, principalAmount: BNB_PRINCIPAL_AMOUNT, leverage: 1.2 },
  ]

  let alice: SignerWithAddress
  let account: AllConnectorsBSC
  let lens: LendingPlatformLens
  let registry: FoldingRegistry
  let nft: FodlNFT
  let router: PancakeswapRouter
  let venusPriceMock: CompoundPriceOracleMock

  const fixture = deployments.createFixture(async (hre: HardhatRuntimeEnvironment) => {
    const signers = await ethers.getSigners()
    alice = signers[0]

    const {
      FoldingRegistry_Proxy: { address: registryAddress },
      FodlNFT: { address: fodlNFTAddress },
      LendingPlatformLens: { address: lensAddress },
      CompoundPriceOracleMock: { address: oracleMockAddress },
    } = await deployments.fixture()

    registry = FoldingRegistry__factory.connect(registryAddress, alice)
    nft = FodlNFT__factory.connect(fodlNFTAddress, alice)
    lens = LendingPlatformLens__factory.connect(lensAddress, ethers.provider)
    router = PancakeswapRouter__factory.connect(PANCAKE_ROUTER, ethers.provider)
    venusPriceMock = CompoundPriceOracleMock__factory.connect(oracleMockAddress, alice)

    account = AllConnectorsBSC__factory.connect(await registry.callStatic.createAccount(), alice)
    await registry.createAccount()

    await sendToken(WBNB, alice.address, BNB_PRINCIPAL_AMOUNT * 100)
    await sendToken(BTCB, alice.address, BTC_PRINCIPAL_AMOUNT * 100)
    await sendToken(BSCDAI, alice.address, USD_PRINCIPAL_AMOUNT * 100)
    await sendToken(BSCUSDC, alice.address, USD_PRINCIPAL_AMOUNT * 100)
    await sendToken(BSCETH, alice.address, BNB_PRINCIPAL_AMOUNT * 100)
    await sendToken(BUSD, alice.address, USD_PRINCIPAL_AMOUNT * 100)

    await WBNB.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
    await BTCB.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
    await BSCDAI.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
    await BSCUSDC.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
    await BSCETH.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
    await BUSD.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
  })

  beforeEach('deploy system', async () => {
    await fixture()
  })

  TESTS_TABLE_TRADE.forEach(({ platform, platformName, principalToken, borrowToken, principalAmount, leverage }) => {
    it(`${platformName}\t${principalToken.symbol}\t${borrowToken.symbol}`, async () => {
      let tokenPath: string[] = []

      const [{ referencePrice: principalTokenPrice }, { referencePrice: borrowTokenPrice }] =
        await lens.callStatic.getAssetMetadata(
          [VENUS_PLATFORM, VENUS_PLATFORM],
          [principalToken.address, borrowToken.address]
        )

      {
        await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
        const principalAmountBN = float2SolidityTokenAmount(principalToken, principalAmount)
        const supplyAmountBN = float2SolidityTokenAmount(principalToken, principalAmount * leverage)
        const minSupplyAmountBN = BigNumber.from(0)
        const price = principalTokenPrice.mul(MANTISSA).div(borrowTokenPrice)
        const borrowAmountBN = supplyAmountBN.sub(principalAmountBN).mul(price).div(MANTISSA)

        ;({ tokenPath } = await findBestRoute(
          PROTOCOL.PANCAKESWAP_V2,
          CHAIN_ID.BSC,
          borrowToken,
          principalToken,
          borrowAmountBN
        ))
        const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
          ['bytes1', 'address[]'],
          [USE_PANCAKESWAP_EXCHANGE, tokenPath]
        )

        await account.increaseSimplePositionWithLoop(
          platform,
          principalToken.address,
          principalAmountBN,
          minSupplyAmountBN,
          borrowToken.address,
          borrowAmountBN,
          encodedExchangeData
        )
      }

      // Increase leverage
      {
        const targetLeverage = leverage * 1.5
        const positionValue = solidityTokenAmount2Float(principalToken, await account.callStatic.getPositionValue())

        const targetSupplyAmount = positionValue * targetLeverage
        const targetSupplyAmount_BN = float2SolidityTokenAmount(principalToken, targetSupplyAmount)

        const supplyAmountBN = targetSupplyAmount_BN.sub(await account.callStatic.getSupplyBalance())
        const borrowAmount_BN = supplyAmountBN.mul(principalTokenPrice).div(borrowTokenPrice)
        const slippage = MANTISSA.mul(80).div(100)
        const minSupplyAmountBN = supplyAmountBN.mul(slippage).div(MANTISSA)

        const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
          ['bytes1', 'address[]'],
          [USE_PANCAKESWAP_EXCHANGE, tokenPath]
        )

        await account.increaseSimplePositionWithLoop(
          platform,
          principalToken.address,
          0,
          minSupplyAmountBN,
          borrowToken.address,
          borrowAmount_BN,
          encodedExchangeData
        )
      }

      // Withdraw without changing leverage
      {
        const withdrawAmount = principalAmount / 10
        const withdrawAmount_BN = float2SolidityTokenAmount(principalToken, withdrawAmount)

        const supplyBalance = solidityTokenAmount2Float(principalToken, await account.callStatic.getSupplyBalance())
        const positionValue = solidityTokenAmount2Float(principalToken, await account.callStatic.getPositionValue())

        const targetLeverage = supplyBalance / positionValue
        const targetSupplyAmount = (positionValue - withdrawAmount) * targetLeverage

        if (targetSupplyAmount < 0) throw new Error(`Withdraw amount too high`)

        const targetSupplyAmount_BN = float2SolidityTokenAmount(principalToken, targetSupplyAmount)

        const redeemAmount_BN = (await account.callStatic.getSupplyBalance())
          .sub(targetSupplyAmount_BN)
          .sub(withdrawAmount_BN)

        // Slippage is applied to minRepayAmount: substract slippage percentage
        const minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice).mul(80).div(100)

        // const minRepayAmount_BN = BigNumber.from(0)

        const _tokenPath = cloneDeep(tokenPath).reverse()

        const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
          ['bytes1', 'address[]'],
          [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
        )

        await account.decreaseSimplePositionWithFlashswap(
          platform,
          principalToken.address,
          withdrawAmount_BN,
          redeemAmount_BN,
          borrowToken.address,
          minRepayAmount_BN,
          encodedExchangeData
        )

        const finalSupplyBalance = solidityTokenAmount2Float(
          principalToken,
          await account.callStatic.getSupplyBalance()
        )
        expect(finalSupplyBalance).to.be.closeTo(targetSupplyAmount, targetSupplyAmount * MAX_DEVIATION)
      }

      // // Decrease leverage
      {
        const targetLeverage = 1.02
        const positionValue = solidityTokenAmount2Float(principalToken, await account.callStatic.getPositionValue())
        const targetSupplyAmount = positionValue * targetLeverage
        const targetSupplyAmount_BN = float2SolidityTokenAmount(principalToken, targetSupplyAmount)

        const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(targetSupplyAmount_BN)

        let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
        minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

        // findBestBSCRoute(principalToken, borrowToken, minRepayAmount_BN))
        const _tokenPath = cloneDeep(tokenPath).reverse()

        const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
          ['bytes1', 'address[]'],
          [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
        )

        await account.decreaseSimplePositionWithFlashswap(
          platform,
          principalToken.address,
          0,
          redeemAmount_BN,
          borrowToken.address,
          minRepayAmount_BN,
          encodedExchangeData
        )

        const finalSupplyBalance = solidityTokenAmount2Float(
          principalToken,
          await account.callStatic.getSupplyBalance()
        )
        expect(finalSupplyBalance).to.be.closeTo(targetSupplyAmount, targetSupplyAmount * MAX_DEVIATION)
      }

      // Close position
      {
        const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(
          await account.callStatic.getPositionValue()
        )
        let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
        minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

        // findBestBSCRoute(principalToken, borrowToken, minRepayAmount_BN))
        const _tokenPath = cloneDeep(tokenPath).reverse()

        const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
          ['bytes1', 'address[]'],
          [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
        )

        await account.decreaseSimplePositionWithFlashswap(
          platform,
          principalToken.address,
          ethers.constants.MaxUint256,
          ethers.constants.MaxUint256,
          borrowToken.address,
          minRepayAmount_BN,
          encodedExchangeData
        )

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.equal(0)
      }
    })
  })

  TESTS_TABLE_FARM.forEach(({ platform, platformName, token, principalAmount, leverage }) => {
    it(`${platformName}\t${token.symbol}\t${token.symbol}`, async () => {
      // Open position
      const exchangeData = ethers.utils.defaultAbiCoder.encode(['bytes1', 'address[]'], [USE_PANCAKESWAP_EXCHANGE, []])
      {
        const principalAmountBN = float2SolidityTokenAmount(token, principalAmount)
        const supplyAmountBN = float2SolidityTokenAmount(token, principalAmount * leverage)
        const minSupplyAmountBN = BigNumber.from(0)
        const borrowAmountBN = supplyAmountBN.sub(principalAmountBN)

        await account.increaseSimplePositionWithLoop(
          platform,
          token.address,
          principalAmountBN,
          minSupplyAmountBN,
          token.address,
          borrowAmountBN,
          exchangeData
        )
      }

      // Increase leverage:
      {
        const targetLeverage = leverage * 1.5
        const positionValue = solidityTokenAmount2Float(token, await account.callStatic.getPositionValue())
        const targetSupplyAmount = positionValue * targetLeverage
        const targetSupplyAmount_BN = float2SolidityTokenAmount(token, targetSupplyAmount)

        const supplyAmountBN = targetSupplyAmount_BN.sub(await account.callStatic.getSupplyBalance())
        const borrowAmountBN = supplyAmountBN
        const minSupplyAmountBN = supplyAmountBN.sub(
          supplyAmountBN.mul(PANCAKESWAP_FEE_NUMERATOR).div(PANCAKESWAP_FEE_DENOMINATOR)
        )

        await account.increaseSimplePositionWithLoop(
          platform,
          token.address,
          0,
          minSupplyAmountBN,
          token.address,
          borrowAmountBN,
          exchangeData
        )
      }

      // Withdraw without changing leverage
      {
        const withdrawAmount = principalAmount / 10
        const withdrawAmount_BN = float2SolidityTokenAmount(token, withdrawAmount)

        const supplyBalance = solidityTokenAmount2Float(token, await account.callStatic.getSupplyBalance())
        const positionValue = solidityTokenAmount2Float(token, await account.callStatic.getPositionValue())

        const targetLeverage = supplyBalance / positionValue
        const targetSupplyAmount = (positionValue - withdrawAmount) * targetLeverage

        if (targetSupplyAmount < 0) throw new Error(`Withdraw amount too high`)

        const targetSupplyAmount_BN = float2SolidityTokenAmount(token, targetSupplyAmount)

        const minRepayAmount_BN = (await account.callStatic.getSupplyBalance())
          .sub(targetSupplyAmount_BN)
          .sub(withdrawAmount_BN)

        await account.decreaseSimplePositionWithFlashswap(
          platform,
          token.address,
          withdrawAmount_BN,
          0,
          token.address,
          minRepayAmount_BN,
          exchangeData
        )

        const finalSupplyBalance = solidityTokenAmount2Float(token, await account.callStatic.getSupplyBalance())
        expect(finalSupplyBalance).to.be.closeTo(targetSupplyAmount, targetSupplyAmount * MAX_DEVIATION)
      }

      // Decrease leverage
      {
        const targetLeverage = 1.02
        const positionValue = solidityTokenAmount2Float(token, await account.callStatic.getPositionValue())

        const targetSupplyAmount = positionValue * targetLeverage

        const targetSupplyAmount_BN = float2SolidityTokenAmount(token, targetSupplyAmount)

        let minRepayAmount_BN = (await account.callStatic.getSupplyBalance()).sub(targetSupplyAmount_BN)

        await account.decreaseSimplePositionWithFlashswap(
          platform,
          token.address,
          0,
          0,
          token.address,
          minRepayAmount_BN,
          exchangeData
        )

        const finalSupplyBalance = solidityTokenAmount2Float(token, await account.callStatic.getSupplyBalance())
        expect(finalSupplyBalance).to.be.closeTo(targetSupplyAmount, targetSupplyAmount * MAX_DEVIATION)
      }

      // Close position
      {
        await account.decreaseSimplePositionWithFlashswap(
          platform,
          token.address,
          ethers.constants.MaxUint256,
          ethers.constants.MaxUint256,
          token.address,
          ethers.constants.MaxUint256,
          exchangeData
        )

        expect(await account.callStatic.getCollateralUsageFactor()).to.be.equal(0)
      }
    })
  })

  it('can close after a position goes beyond liquidation threshold', async () => {
    const platform = VENUS_PLATFORM
    const principalToken = WBNB
    const borrowToken = BUSD
    const principalAmount = BNB_PRINCIPAL_AMOUNT
    const leverage = 3

    const tokenPath = [borrowToken.address, principalToken.address]

    const [{ referencePrice: principalTokenPrice }, { referencePrice: borrowTokenPrice }] =
      await lens.callStatic.getAssetMetadata(
        [VENUS_PLATFORM, VENUS_PLATFORM],
        [principalToken.address, borrowToken.address]
      )

    {
      await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
      const principalAmountBN = float2SolidityTokenAmount(principalToken, principalAmount)
      const supplyAmountBN = float2SolidityTokenAmount(principalToken, principalAmount * leverage)
      const minSupplyAmountBN = BigNumber.from(0)
      const price = principalTokenPrice.mul(MANTISSA).div(borrowTokenPrice)
      const borrowAmountBN = supplyAmountBN.sub(principalAmountBN).mul(price).div(MANTISSA)

      // console.log(tokenPath)
      // console.log([principalToken.address, borrowToken.address])

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, tokenPath]
      )

      await account.increaseSimplePositionWithLoop(
        platform,
        principalToken.address,
        principalAmountBN,
        minSupplyAmountBN,
        borrowToken.address,
        borrowAmountBN,
        encodedExchangeData
      )
    }

    // Close position
    {
      const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(
        await account.callStatic.getPositionValue()
      )
      let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
      minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

      const _tokenPath = cloneDeep(tokenPath).reverse()

      await venusPriceMock.setPriceUpdate(VENUS_TOKENS_TO_VTOKENS[principalToken.address], parseEther('0.5'))
      expect(await account.callStatic.getCollateralUsageFactor()).to.be.gte(MANTISSA)

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
      )

      await account.decreaseSimplePositionWithFlashswap(
        platform,
        principalToken.address,
        ethers.constants.MaxUint256,
        redeemAmount_BN,
        borrowToken.address,
        minRepayAmount_BN,
        encodedExchangeData
      )

      expect(await account.callStatic.getCollateralUsageFactor()).to.be.equal(0)
      expect(await account.callStatic.getSupplyBalance()).to.be.equal(0)
    }
  })

  it('can close a position with a single hop route', async () => {
    const platform = VENUS_PLATFORM
    const principalToken = WBNB
    const borrowToken = BUSD
    const principalAmount = BNB_PRINCIPAL_AMOUNT
    const leverage = 3

    const tokenPath = [borrowToken.address, principalToken.address]

    const [{ referencePrice: principalTokenPrice }, { referencePrice: borrowTokenPrice }] =
      await lens.callStatic.getAssetMetadata(
        [VENUS_PLATFORM, VENUS_PLATFORM],
        [principalToken.address, borrowToken.address]
      )

    {
      await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
      const principalAmountBN = float2SolidityTokenAmount(principalToken, principalAmount)
      const supplyAmountBN = float2SolidityTokenAmount(principalToken, principalAmount * leverage)
      const minSupplyAmountBN = BigNumber.from(0)
      const price = principalTokenPrice.mul(MANTISSA).div(borrowTokenPrice)
      const borrowAmountBN = supplyAmountBN.sub(principalAmountBN).mul(price).div(MANTISSA)

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, tokenPath]
      )

      await account.increaseSimplePositionWithLoop(
        platform,
        principalToken.address,
        principalAmountBN,
        minSupplyAmountBN,
        borrowToken.address,
        borrowAmountBN,
        encodedExchangeData
      )
    }

    // Close position
    {
      const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(
        await account.callStatic.getPositionValue()
      )
      let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
      minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

      const _tokenPath = cloneDeep(tokenPath).reverse()

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
      )

      await account.decreaseSimplePositionWithFlashswap(
        platform,
        principalToken.address,
        ethers.constants.MaxUint256,
        redeemAmount_BN,
        borrowToken.address,
        minRepayAmount_BN,
        encodedExchangeData
      )

      expect(await account.callStatic.getCollateralUsageFactor()).to.be.equal(0)
      expect(await account.callStatic.getSupplyBalance()).to.be.equal(0)
    }
  })

  it('can close a position with a multiple hop route', async () => {
    const platform = VENUS_PLATFORM
    const principalToken = WBNB
    const midHopToken = BSCUSDT
    const borrowToken = BUSD
    const principalAmount = BNB_PRINCIPAL_AMOUNT
    const leverage = 3

    const tokenPath = [borrowToken.address, midHopToken.address, principalToken.address]

    const [{ referencePrice: principalTokenPrice }, { referencePrice: borrowTokenPrice }] =
      await lens.callStatic.getAssetMetadata(
        [VENUS_PLATFORM, VENUS_PLATFORM],
        [principalToken.address, borrowToken.address]
      )

    {
      await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
      const principalAmountBN = float2SolidityTokenAmount(principalToken, principalAmount)
      const supplyAmountBN = float2SolidityTokenAmount(principalToken, principalAmount * leverage)
      const minSupplyAmountBN = BigNumber.from(0)
      const price = principalTokenPrice.mul(MANTISSA).div(borrowTokenPrice)
      const borrowAmountBN = supplyAmountBN.sub(principalAmountBN).mul(price).div(MANTISSA)

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, tokenPath]
      )

      await account.increaseSimplePositionWithLoop(
        platform,
        principalToken.address,
        principalAmountBN,
        minSupplyAmountBN,
        borrowToken.address,
        borrowAmountBN,
        encodedExchangeData
      )
    }

    // Close position
    {
      const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(
        await account.callStatic.getPositionValue()
      )
      let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
      minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

      const _tokenPath = cloneDeep(tokenPath).reverse()

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
      )

      await account.decreaseSimplePositionWithFlashswap(
        platform,
        principalToken.address,
        ethers.constants.MaxUint256,
        redeemAmount_BN,
        borrowToken.address,
        minRepayAmount_BN,
        encodedExchangeData
      )

      expect(await account.callStatic.getCollateralUsageFactor()).to.be.equal(0)
      expect(await account.callStatic.getSupplyBalance()).to.be.equal(0)
    }
  })

  it('can close a position with all debt paid', async () => {
    const platform = VENUS_PLATFORM
    const principalToken = WBNB

    const borrowToken = BUSD
    const principalAmount = BNB_PRINCIPAL_AMOUNT
    const leverage = 3

    const tokenPath = [borrowToken.address, principalToken.address]

    const [{ referencePrice: principalTokenPrice }, { referencePrice: borrowTokenPrice }] =
      await lens.callStatic.getAssetMetadata(
        [VENUS_PLATFORM, VENUS_PLATFORM],
        [principalToken.address, borrowToken.address]
      )

    {
      await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)
      const principalAmountBN = float2SolidityTokenAmount(principalToken, principalAmount)
      const supplyAmountBN = float2SolidityTokenAmount(principalToken, principalAmount * leverage)
      const minSupplyAmountBN = BigNumber.from(0)
      const price = principalTokenPrice.mul(MANTISSA).div(borrowTokenPrice)
      const borrowAmountBN = supplyAmountBN.sub(principalAmountBN).mul(price).div(MANTISSA)

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, tokenPath]
      )

      await account.increaseSimplePositionWithLoop(
        platform,
        principalToken.address,
        principalAmountBN,
        minSupplyAmountBN,
        borrowToken.address,
        borrowAmountBN,
        encodedExchangeData
      )
    }

    // Repay all debt
    {
      const vToken = ICToken__factory.connect(VENUS_TOKENS_TO_VTOKENS[principalToken.address], alice)

      await principalToken.contract.connect(alice).approve(vToken.address, ethers.constants.MaxUint256)
      await vToken.connect(alice).repayBorrowBehalf(account.address, ethers.constants.MaxUint256)
    }

    // Close position
    {
      const redeemAmount_BN = (await account.callStatic.getSupplyBalance()).sub(
        await account.callStatic.getPositionValue()
      )
      let minRepayAmount_BN = redeemAmount_BN.mul(principalTokenPrice).div(borrowTokenPrice)
      minRepayAmount_BN = minRepayAmount_BN.mul(80).div(100) // Substract slippage

      const _tokenPath = cloneDeep(tokenPath).reverse()

      const encodedExchangeData = ethers.utils.defaultAbiCoder.encode(
        ['bytes1', 'address[]'],
        [USE_PANCAKESWAP_EXCHANGE, _tokenPath]
      )

      await account.decreaseSimplePositionWithFlashswap(
        platform,
        principalToken.address,
        ethers.constants.MaxUint256,
        redeemAmount_BN,
        borrowToken.address,
        minRepayAmount_BN,
        encodedExchangeData
      )

      expect(await account.callStatic.getSupplyBalance()).to.be.equal(0)
    }
  })
})

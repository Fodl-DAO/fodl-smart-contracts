import { ChainId } from '@sushiswap/sdk'
import { expect } from 'chai'
import { formatUnits, parseUnits } from 'ethers/lib/utils'
import { deployments, ethers, config } from 'hardhat'
import { SignerWithAddress } from 'hardhat-deploy-ethers/signers'
import { AAVE_PLATFORM, ONE_INCH_SPOT_PRICE_ORACLES } from '../constants/deploy'
import { CRV, DAI, LINK, SUSHI, TokenData, USDC, USDT, WBTC, WETH } from '../constants/tokens'
import { sendToken } from '../scripts/utils'
import { AaveOneInchQuoter, AllConnectors, IOneInchOffchainOracle__factory, LendingPlatformLens } from '../typechain'
import { recodeOneInchQuote } from '../utils/recodeOneInchQuote'
import { MANTISSA } from '../test/shared/constants'
import { simplePositionFixture } from '../test/shared/fixtures'
import { convertPrice, solidityTokenAmount2Float } from '../test/shared/utils'
import { IOneInchResponse, PROTOCOL, queryOneInch } from './utils/RouteFinders'
import { reverseExactInQuote } from '../utils/reverseExactInQuote'
import { StaticJsonRpcProvider } from '@ethersproject/providers'

describe('AavePositionIncreaseConnector', () => {
  const chainId = ChainId.MAINNET

  const slippage = 0.02 // 2% of slippage
  const slippageBN = parseUnits(`${slippage}`)

  const errorTolerance = 0.1 // 10% of error tolerance
  const errorToleranceBN = parseUnits(`${errorTolerance}`)

  let alice: SignerWithAddress

  let account: AllConnectors
  let quoter: AaveOneInchQuoter

  let oneInchArtifact: IOneInchResponse

  // Max leverage for a coin: CF / (1-CF) where CF = Collateral Factor
  interface ITEST_TABLE {
    platformName: string
    platform: string
    supplyToken: TokenData
    borrowToken: TokenData
    principalAmount: number
    leverage: number
  }

  const onAave = {
    platformName: 'AAVE',
    platform: AAVE_PLATFORM,
  }

  const TESTS_TABLE: ITEST_TABLE[] = [
    // test case of same 18 decimals
    { ...onAave, supplyToken: WETH, borrowToken: DAI, principalAmount: 500, leverage: 2 },
    // test case of same 6 decimals
    { ...onAave, supplyToken: USDC, borrowToken: USDT, principalAmount: 5_000_000, leverage: 2 },
    // test case of 18 decimals vs non 18 decimals
    { ...onAave, supplyToken: WETH, borrowToken: USDC, principalAmount: 500, leverage: 2 },
    // // test case of non 18 decimals vs non 18 decimals
    { ...onAave, supplyToken: WBTC, borrowToken: USDC, principalAmount: 100, leverage: 1.5 },
    // test case of non ERC20 compliant token
    { ...onAave, supplyToken: WETH, borrowToken: USDT, principalAmount: 500, leverage: 2 },
    // test case of liquid token vs non liquid token
    { ...onAave, supplyToken: WBTC, borrowToken: LINK, principalAmount: 20, leverage: 1.5 },
    // test case of non liquid token vs non liquid token
    { ...onAave, supplyToken: LINK, borrowToken: CRV, principalAmount: 10_000, leverage: 0.5 },

    // { ...onAave, supplyToken: WETH, borrowToken: USDC, principalAmount: 500, leverage: 3.5 },
    // { ...onAave, supplyToken: WETH, borrowToken: USDT, principalAmount: 500, leverage: 3.5 },
    // { ...onAave, supplyToken: WETH, borrowToken: WBTC, principalAmount: 500, leverage: 3.5 },
    // { ...onAave, supplyToken: WETH, borrowToken: LINK, principalAmount: 500, leverage: 3.5 },
    // { ...onAave, supplyToken: WBTC, borrowToken: WETH, principalAmount: 100, leverage: 3 },
    // { ...onAave, supplyToken: WBTC, borrowToken: USDC, principalAmount: 100, leverage: 3 },
    // { ...onAave, supplyToken: WBTC, borrowToken: USDT, principalAmount: 100, leverage: 3 },
    // { ...onAave, supplyToken: WBTC, borrowToken: LINK, principalAmount: 100, leverage: 3 },
    // { ...onAave, supplyToken: LINK, borrowToken: WETH, principalAmount: 10_000, leverage: 1.3 },
    // { ...onAave, supplyToken: LINK, borrowToken: USDC, principalAmount: 10_000, leverage: 1.3 },
    // { ...onAave, supplyToken: LINK, borrowToken: USDT, principalAmount: 10_000, leverage: 1.3 },
    // { ...onAave, supplyToken: LINK, borrowToken: WBTC, principalAmount: 10_000, leverage: 1.3 },
    // { ...onAave, supplyToken: USDC, borrowToken: WETH, principalAmount: 5_000_000, leverage: 3 },
    // { ...onAave, supplyToken: USDC, borrowToken: USDT, principalAmount: 5_000_000, leverage: 3 },
    // { ...onAave, supplyToken: USDC, borrowToken: WBTC, principalAmount: 5_000_000, leverage: 3 },
    // { ...onAave, supplyToken: USDC, borrowToken: LINK, principalAmount: 5_000_00, leverage: 3 },
  ]

  // Deploy system, get quoter and lending lens, fund the users with tokens and set up approvals
  const fixture = deployments.createFixture(async (hre) => {
    const fixt = await simplePositionFixture()
    const quoter = (await hre.ethers.getContract('AaveOneInchQuoter')).connect(fixt.alice) as AaveOneInchQuoter

    const lendingLens = (await hre.ethers.getContract('LendingPlatformLens')) as LendingPlatformLens

    let testedTokens: string[] = []

    for (const { supplyToken, principalAmount } of TESTS_TABLE) {
      if (testedTokens.includes(supplyToken.address)) continue
      testedTokens.push(supplyToken.address)
      await sendToken(supplyToken, fixt.alice.address, principalAmount * 10)
      await supplyToken.contract.connect(fixt.alice).approve(fixt.account.address, ethers.constants.MaxUint256)
    }

    return { ...fixt, quoter, lendingLens }
  })

  beforeEach('load fixture', async () => {
    ;({ alice, account, quoter } = await fixture())
  })

  describe('when supply token != borrow token', () => {
    const protocols: PROTOCOL[] = [
      PROTOCOL.UNISWAP_V2,
      PROTOCOL.UNISWAP_V3,
      PROTOCOL.SUSHI,
      PROTOCOL.CURVE,
      PROTOCOL.CURVE_V2,
      PROTOCOL.BALANCER,
    ]

    TESTS_TABLE.forEach(({ platformName, platform, supplyToken, borrowToken, principalAmount, leverage }) => {
      describe(`${platformName}\t${supplyToken.symbol}\t${borrowToken.symbol}`, () => {
        let price = 0

        before('get price', async () => {
          // This call is incredibly expensive and it takes a lot of time (>1 minute) because hardhat
          // caches all the storage slots it touchs. Integration tests are meant to be run
          // in latest block, so it makes sense to query the RPC directly
          const provider =
            config.networks.hardhat.forking?.url && config.networks.hardhat.forking?.blockNumber === undefined
              ? new StaticJsonRpcProvider(config.networks.hardhat.forking.url)
              : ethers.provider

          const spotPriceOracle = IOneInchOffchainOracle__factory.connect(
            ONE_INCH_SPOT_PRICE_ORACLES[chainId],
            provider
          )

          price = await spotPriceOracle // units: supplyToken / borrowToken
            .getRate(borrowToken.address, supplyToken.address, false)
            .then((priceBN) => convertPrice(priceBN, borrowToken.decimals, supplyToken.decimals) as number)
        })

        it('can open the position', async () => {
          const flashloanAmount = principalAmount * leverage
          const borrowAmount = flashloanAmount / price
          const principalAmountBN = parseUnits(principalAmount.toFixed(supplyToken.decimals), supplyToken.decimals)
          const borrowAmountBN = parseUnits(borrowAmount.toFixed(borrowToken.decimals), borrowToken.decimals)

          oneInchArtifact = await queryOneInch(borrowToken.address, supplyToken.address, borrowAmountBN, protocols, {
            linear: false,
            chainId,
          })

          const oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            borrowAmountBN,
            account.address
          ).modifiedPayloadWithSelector

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

          // Check position has been correctly opened
          expect(await account.callStatic.getSupplyBalance()).to.be.gte(minSupplyAmountBN)
          expect(await account.callStatic.getBorrowBalance()).to.be.closeTo(borrowAmountBN, borrowAmountBN.div(100))
        })

        it('can increase leverage without adding principal', async () => {
          const initialSAmt = principalAmount * (1 + leverage)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const targetLeverage = leverage * 1.1 // Increase leverage by %10
          const targetSupplyAmount = principalAmount * (1 + targetLeverage)

          const supplyDelta = targetSupplyAmount - initialSAmt
          const borrowDelta = supplyDelta / price

          const borrowDeltaBN = parseUnits(borrowDelta.toFixed(borrowToken.decimals), borrowToken.decimals)

          const oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            borrowDeltaBN,
            account.address
          ).modifiedPayloadWithSelector

          const quotedSupplyDelta = await quoter.callStatic.quote(borrowDeltaBN, oneInchTxData)
          const minSupplyAmountBN = quotedSupplyDelta.sub(quotedSupplyDelta.mul(slippageBN).div(MANTISSA))

          const collateralUsageFactor = await account.callStatic.getCollateralUsageFactor()

          await account.aavePosition_Increase(
            platform,
            supplyToken.address,
            0,
            minSupplyAmountBN,
            borrowToken.address,
            borrowDeltaBN,
            oneInchTxData
          )

          expect(await account.callStatic.getCollateralUsageFactor()).to.be.gt(collateralUsageFactor)
        })

        it('can increase leverage and add principal', async () => {
          const initialSAmt = principalAmount * (1 + leverage)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const principalAmountBN = parseUnits(principalAmount.toFixed(supplyToken.decimals), supplyToken.decimals)
          const additionalPrincipalAmount = principalAmount
          const additionalPrincipalAmountBN = parseUnits(
            additionalPrincipalAmount.toFixed(supplyToken.decimals),
            supplyToken.decimals
          )

          const targetLeverage = leverage * 1.01 // Increase leverage by %1
          const targetSupplyAmount = (principalAmount + additionalPrincipalAmount) * (1 + targetLeverage)

          const supplyDelta = targetSupplyAmount - initialSAmt - additionalPrincipalAmount
          const borrowDelta = supplyDelta / price

          const borrowDeltaBN = parseUnits(borrowDelta.toFixed(borrowToken.decimals), borrowToken.decimals)

          const oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            borrowDeltaBN,
            account.address
          ).modifiedPayloadWithSelector

          const quotedSupplyDelta = await quoter.callStatic.quote(borrowDeltaBN, oneInchTxData)
          const minSupplyAmountBN = additionalPrincipalAmountBN
            .add(quotedSupplyDelta)
            .sub(quotedSupplyDelta.mul(slippageBN).div(MANTISSA))

          const getCollateralUsageFactor = account.callStatic.getCollateralUsageFactor
          const getPositionValue = account.callStatic.getPositionValue

          const collateralUsageFactor = await getCollateralUsageFactor()
          const positionValueBN = await getPositionValue()
          await account.aavePosition_Increase(
            platform,
            supplyToken.address,
            additionalPrincipalAmountBN,
            minSupplyAmountBN,
            borrowToken.address,
            borrowDeltaBN,
            oneInchTxData
          )

          const expectedPositionValueBN = positionValueBN.add(principalAmountBN)

          expect(await getCollateralUsageFactor()).to.be.gt(collateralUsageFactor)
          expect(await getPositionValue()).to.be.closeTo(
            expectedPositionValueBN,
            expectedPositionValueBN.mul(errorToleranceBN).div(MANTISSA)
          )
        })

        it('can lower leverage by adding principal', async () => {
          const initialSAmt = principalAmount * (1 + leverage)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const additionalPrincipalAmount = principalAmount
          const additionalPrincipalAmountBN = parseUnits(
            additionalPrincipalAmount.toFixed(supplyToken.decimals),
            supplyToken.decimals
          )

          const collateralUsageFactor = await account.callStatic.getCollateralUsageFactor()

          await account.aavePosition_Increase(
            platform,
            supplyToken.address,
            additionalPrincipalAmountBN,
            0,
            borrowToken.address,
            0,
            '0x00'
          )

          expect(await account.callStatic.getCollateralUsageFactor()).to.be.lt(collateralUsageFactor)
        })

        it('can lower leverage by repaying debt', async () => {
          const initialSAmt = principalAmount * (leverage + 1)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const decreaseFactor = 2 // This number must be whole for the test to succeed

          const targetLeverage = leverage / decreaseFactor // Cut leverage in half
          const targetSupplyAmount = principalAmount * (1 + targetLeverage)

          const supplyDelta = initialSAmt - targetSupplyAmount
          const supplyDeltaBN = parseUnits(supplyDelta.toFixed(supplyToken.decimals), supplyToken.decimals)

          oneInchArtifact = await queryOneInch(supplyToken.address, borrowToken.address, supplyDeltaBN, protocols, {
            linear: false,
          })
          const borrowDelta = supplyDelta / price
          const borrowDeltaBN = parseUnits(borrowDelta.toFixed(borrowToken.decimals), borrowToken.decimals)

          let { amountIn: maxRedeemAmountBN, amountOut: repayAmountBN } = await reverseExactInQuote(
            supplyDeltaBN,
            borrowDeltaBN,
            quoter,
            oneInchArtifact
          )
          maxRedeemAmountBN = maxRedeemAmountBN.add(maxRedeemAmountBN.mul(slippageBN).div(MANTISSA))

          let oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            maxRedeemAmountBN,
            account.address
          ).modifiedPayloadWithSelector

          const debtBeforeDecrease = await account.callStatic.getBorrowBalance()
          const expectedDebtAfterDecrease = debtBeforeDecrease.div(decreaseFactor)

          await account.aavePosition_Decrease(
            platform,
            supplyToken.address,
            0,
            maxRedeemAmountBN,
            borrowToken.address,
            repayAmountBN,
            oneInchTxData
          )

          expect(await account.callStatic.getBorrowBalance()).to.be.closeTo(
            expectedDebtAfterDecrease,
            expectedDebtAfterDecrease.mul(errorToleranceBN).div(MANTISSA)
          )
        })

        it('can withdraw without changing leverage', async () => {
          const initialSAmt = principalAmount * (leverage + 1)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const withdrawAmount = principalAmount / 2
          const withdrawAmountBN = parseUnits(withdrawAmount.toFixed(supplyToken.decimals), supplyToken.decimals)
          const newPrincipalAmount = principalAmount - withdrawAmount

          const targetSupplyAmount = newPrincipalAmount * (1 + leverage)
          const supplyDelta = initialSAmt - targetSupplyAmount - withdrawAmount
          const supplyDeltaBN = parseUnits(supplyDelta.toFixed(supplyToken.decimals), supplyToken.decimals)

          const borrowDelta = supplyDelta / price
          const borrowDeltaBN = parseUnits(borrowDelta.toFixed(borrowToken.decimals), borrowToken.decimals)

          let { amountIn: maxRedeemAmountBN, amountOut: repayAmountBN } = await reverseExactInQuote(
            supplyDeltaBN,
            borrowDeltaBN,
            quoter,
            oneInchArtifact
          )
          maxRedeemAmountBN = maxRedeemAmountBN.add(maxRedeemAmountBN.mul(slippageBN).div(MANTISSA))

          let oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            maxRedeemAmountBN,
            account.address
          ).modifiedPayloadWithSelector

          const collateralUsageFactorBeforeOperation = await account.callStatic.getCollateralUsageFactor()

          await account.aavePosition_Decrease(
            platform,
            supplyToken.address,
            withdrawAmountBN,
            maxRedeemAmountBN,
            borrowToken.address,
            repayAmountBN,
            oneInchTxData
          )

          expect(await account.callStatic.getCollateralUsageFactor()).to.be.closeTo(
            collateralUsageFactorBeforeOperation,
            collateralUsageFactorBeforeOperation.mul(errorToleranceBN).div(MANTISSA)
          )
        })

        // Pure withdraw not supported by UI
        it.skip('can withdraw and increase leverage', async () => {
          const initialSAmt = principalAmount * (1 + leverage)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const withdrawAmount = principalAmount / 100 // Withdraw just 1% of the position
          const withdrawAmountBN = parseUnits(withdrawAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

          const collateralUsageFactor = await account.callStatic.getCollateralUsageFactor()

          console.log('CF', formatUnits(collateralUsageFactor))
          await account.aavePosition_Decrease(
            platform,
            supplyToken.address,
            withdrawAmountBN,
            0,
            borrowToken.address,
            0,
            '0x00'
          )

          expect(await account.callStatic.getCollateralUsageFactor()).to.be.gt(collateralUsageFactor)
        })

        it('can close the position', async () => {
          const initialSAmt = principalAmount * (leverage + 1)
          const initialBAmt = (principalAmount * leverage) / price
          const initialSAmtBN = parseUnits(initialSAmt.toFixed(supplyToken.decimals), supplyToken.decimals)
          const initialBAmtBN = parseUnits(initialBAmt.toFixed(borrowToken.decimals), borrowToken.decimals)

          await account.increaseSimplePositionWithFunds(
            platform,
            supplyToken.address,
            initialSAmtBN,
            borrowToken.address,
            initialBAmtBN
          )

          const debtBN = await account.callStatic.getBorrowBalance()
          const debt = solidityTokenAmount2Float(borrowToken, debtBN)

          const baseRedeemAmount = debt * price
          let baseRedeemAmountBN = parseUnits(baseRedeemAmount.toFixed(supplyToken.decimals), supplyToken.decimals)

          baseRedeemAmountBN = (await reverseExactInQuote(baseRedeemAmountBN, debtBN, quoter, oneInchArtifact)).amountIn
          const maxRedeemAmountBN = baseRedeemAmountBN.add(baseRedeemAmountBN.mul(slippageBN).div(MANTISSA))

          const oneInchTxData = recodeOneInchQuote(
            oneInchArtifact,
            maxRedeemAmountBN,
            account.address
          ).modifiedPayloadWithSelector

          await account.aavePosition_Decrease(
            platform,
            supplyToken.address,
            ethers.constants.MaxUint256,
            maxRedeemAmountBN,
            borrowToken.address,
            ethers.constants.MaxUint256,
            oneInchTxData
          )
        })
      })
    })

    afterEach('log one inch data if failure', async function () {
      if (this.currentTest?.state != 'passed') {
        console.log('Test failed, printing one inch artifact')
        console.log(JSON.stringify(oneInchArtifact))
      }
    })
  })
})

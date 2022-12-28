import { ADDRESS_ZERO } from '@uniswap/v3-sdk'
import { expect } from 'chai'
import { BigNumber, ContractTransaction } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'
import { SignerWithAddress } from 'hardhat-deploy-ethers/signers'
import { COMPOUND_PLATFORM, SUBSIDY_HOLDER_ADDRESS_MAINNET } from '../constants/deploy'
import { TokenData, WBTC, DAI, cWBTC2, cDAI } from '../constants/tokens'
import { impersonateAndFundWithETH, sendToken } from '../scripts/utils'
import { AllConnectors, CompoundPriceOracleMock, FundsManagerConnector__factory, ICToken__factory } from '../typechain'
import { MANTISSA } from './shared/constants'
import { simplePositionFixture } from './shared/fixtures'
import { getBalanceDeltas, getCompoundQuote } from './shared/utils'

describe('FundsManagerConnector', () => {
  const ERROR_TOLERANCE = BigNumber.from(100) // 1 / 100 = 1% of error in expected amounts during tests

  const PRINCIPAL_TAX = MANTISSA.div(100)
  const PROFIT_TAX = MANTISSA.div(100)

  const principalToken: TokenData = WBTC
  const principalCToken: TokenData = cWBTC2

  const borrowToken: TokenData = DAI
  const borrowCToken: TokenData = cDAI

  const platform = COMPOUND_PLATFORM

  let price: number // price of principalToken denominated in borrowToken
  const principalAmountFloat = 10
  const principalAmountBN = parseUnits(`${principalAmountFloat}`, principalToken.decimals)
  const leverage: number = 1

  let supplyAmountFloat: number = 0
  let supplyAmountBN: BigNumber = BigNumber.from(0)

  let borrowAmountFloat: number = 0
  let borrowAmountBN: BigNumber = BigNumber.from(0)

  let alice: SignerWithAddress
  let mallory: SignerWithAddress
  let account: AllConnectors
  let compoundPriceOracleMock: CompoundPriceOracleMock

  before('get price', async () => {
    const { amountOut_float } = await getCompoundQuote(platform, principalToken, borrowToken, 1)
    price = amountOut_float
  })

  const fixture = deployments.createFixture(async () => {
    const rets = await simplePositionFixture()
    const { account, alice, foldingRegistry } = rets

    const ownerAddr = await foldingRegistry.owner()
    const owner = await impersonateAndFundWithETH(ownerAddr)
    const { address: connectorAddr } = await deployments.deploy('FundsManagerConnector', {
      from: ownerAddr,
      args: [PRINCIPAL_TAX, PROFIT_TAX, SUBSIDY_HOLDER_ADDRESS_MAINNET],
      skipIfAlreadyDeployed: false,
    })
    const connector = FundsManagerConnector__factory.connect(connectorAddr, owner)

    const sigs = Object.values(connector.interface.functions).map((f: any) => connector.interface.getSighash(f.name))
    await foldingRegistry.addImplementation(connector.address, sigs)

    supplyAmountFloat = principalAmountFloat + principalAmountFloat * leverage
    supplyAmountBN = parseUnits(supplyAmountFloat.toString(), principalToken.decimals)
    borrowAmountFloat = principalAmountFloat * leverage * price
    borrowAmountBN = parseUnits(borrowAmountFloat.toString(), borrowToken.decimals)

    await sendToken(principalToken.contract, alice.address, supplyAmountBN)
    await principalToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)

    await account
      .connect(alice)
      .increaseSimplePositionWithFunds(
        platform,
        principalToken.address,
        supplyAmountBN,
        borrowToken.address,
        borrowAmountBN
      )

    return rets
  })

  /**
   * @dev redeploys FundsManager connector with independent params
   */
  beforeEach('fixture', async () => {
    ;({ account, compoundPriceOracleMock, alice, mallory } = await fixture())
  })

  describe('constructor', () => {
    it('reverts if invalid params', async () => {
      const factory = new FundsManagerConnector__factory(alice)

      const invalidHolderTx = factory.getDeployTransaction(0, 0, ADDRESS_ZERO)
      await expect(alice.sendTransaction(invalidHolderTx)).to.be.revertedWith('ICP0')

      const invalidPrincipalTx = factory.getDeployTransaction(MANTISSA.add(1), 0, ADDRESS_ZERO)
      await expect(alice.sendTransaction(invalidPrincipalTx)).to.be.revertedWith('ICP1')

      const invalidProfitTx = factory.getDeployTransaction(0, MANTISSA.add(1), ADDRESS_ZERO)
      await expect(alice.sendTransaction(invalidProfitTx)).to.be.revertedWith('ICP1')
    })
  })

  describe('addPrincipal()', () => {
    it('correctly registers used principal', async () => {
      const { principalValue } = await account.callStatic.getPositionMetadata()

      const toleratedError = principalAmountBN.div(ERROR_TOLERANCE)

      expect(principalValue)
        .to.be.gte(principalAmountBN.sub(toleratedError))
        .and.lte(principalAmountBN.add(toleratedError))
    })

    it('rejects if called by external address', async () => {
      await expect(account.connect(mallory).addPrincipal(Math.floor(Math.random() * 10000))).to.be.revertedWith(
        'NOT_AUTHORIZED'
      )
    })
  })

  describe('withdraw()', () => {
    describe('when position is in profit', () => {
      beforeEach('put the position in profit', async () => {
        // Repay debt externally: this has the effect of increasing position value
        const debt = await account.callStatic.getBorrowBalance()
        await sendToken(borrowToken, alice.address, debt.mul(2))
        await borrowToken.contract.connect(alice).approve(borrowCToken.address, ethers.constants.MaxUint256)
        await ICToken__factory.connect(borrowCToken.address, alice).repayBorrowBehalf(
          account.address,
          ethers.constants.MaxUint256
        )
      })

      it('correctly taxes the position', async () => {
        let tx: Promise<ContractTransaction>
        // Fetch balance changes
        const [aliceBalanceDelta, subsidyBalanceDelta] = await getBalanceDeltas(
          () => {
            tx = account
              .connect(alice)
              .decreaseSimplePositionWithFunds(platform, principalToken.address, supplyAmountBN, borrowToken.address, 0)

            return tx
          },
          principalToken,
          [alice.address, SUBSIDY_HOLDER_ADDRESS_MAINNET]
        )

        // Check logs
        const receipt = await tx!.then((tx) => tx.wait())
        const [log] = await account.queryFilter(
          account.filters.FundsWithdrawal(),
          receipt.blockNumber,
          receipt.blockNumber
        )

        const expectedPrincipalFactor = MANTISSA.div(2)
        expect(log.args.withdrawAmount).to.be.equal(supplyAmountBN)
        expect(log.args.principalFactor)
          .to.be.gte(expectedPrincipalFactor.sub(expectedPrincipalFactor.div(ERROR_TOLERANCE)))
          .and.lte(expectedPrincipalFactor.add(expectedPrincipalFactor.div(ERROR_TOLERANCE)))

        // Check profit and principal were correctly taxed
        const approximatedProfitBN = supplyAmountBN.sub(principalAmountBN)
        const expectedPrincipalTaxBN = principalAmountBN.mul(PRINCIPAL_TAX).div(MANTISSA)
        const expectedProfitTaxBN = approximatedProfitBN.mul(PROFIT_TAX).div(MANTISSA).toBigInt()
        const expectedTaxBN = expectedPrincipalTaxBN.add(expectedProfitTaxBN)

        expect(parseUnits(subsidyBalanceDelta.toString(), principalToken.decimals))
          .to.be.gte(expectedTaxBN.sub(expectedTaxBN.div(ERROR_TOLERANCE)))
          .and.lte(expectedTaxBN.add(expectedTaxBN.div(ERROR_TOLERANCE)))

        // Check account owner received the funds
        const expectedAliceDelta = supplyAmountBN.sub(expectedTaxBN)
        expect(parseUnits(aliceBalanceDelta.toString(), principalToken.decimals))
          .to.be.gte(expectedAliceDelta.sub(expectedAliceDelta.div(ERROR_TOLERANCE)))
          .and.lte(expectedAliceDelta.add(expectedAliceDelta.div(ERROR_TOLERANCE)))
      })

      it('correctly returns subsidy, principal share and profit share', async () => {
        const _account = await impersonateAndFundWithETH(account.address)
        await sendToken(principalToken, account.address, supplyAmountBN)
        const positionValue = await account.callStatic.getPositionValue()
        const { principalShare, profitShare, subsidy } = await account
          .connect(_account)
          .callStatic.withdraw(supplyAmountBN, positionValue)

        // Check profit and principal were correctly taxed
        const approximatedProfitBN = supplyAmountBN.sub(principalAmountBN)
        const expectedPrincipalTaxBN = principalAmountBN.mul(PRINCIPAL_TAX).div(MANTISSA)
        const expectedProfitTaxBN = approximatedProfitBN.mul(PROFIT_TAX).div(MANTISSA)
        const expectedTaxBN = expectedPrincipalTaxBN.add(expectedProfitTaxBN)

        expect(profitShare).to.be.closeTo(approximatedProfitBN, approximatedProfitBN.div(ERROR_TOLERANCE))
        expect(principalShare).to.be.closeTo(principalAmountBN, principalAmountBN.div(ERROR_TOLERANCE))
        expect(subsidy).to.be.closeTo(expectedTaxBN, expectedTaxBN.div(ERROR_TOLERANCE))
      })
    })

    describe('when position is in loss', () => {
      it('works with collateral usage factor < 1 (healthy position)', async () => {
        await compoundPriceOracleMock.setPriceUpdate(principalCToken.address, parseUnits('0.95')) // -5% price on principal token

        // Check context aligns with test
        const { collateralUsageFactor, positionValue } = await account.callStatic.getPositionMetadata()
        expect(collateralUsageFactor).to.be.lt(MANTISSA)
        expect(positionValue).to.be.gt(0)

        // Prepare to repay debt
        const debt = await account.callStatic.getBorrowBalance()
        await sendToken(borrowToken, alice.address, debt.mul(2))
        await borrowToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)

        // Withdraw amount
        const redeemAmountBN = supplyAmountBN.div(2)

        let tx: Promise<ContractTransaction>
        // Fetch balance changes
        const [aliceBalanceDelta, subsidyBalanceDelta] = await getBalanceDeltas(
          () => {
            tx = account
              .connect(alice)
              .decreaseSimplePositionWithFunds(
                platform,
                principalToken.address,
                redeemAmountBN,
                borrowToken.address,
                debt
              )

            return tx
          },
          principalToken,
          [alice.address, SUBSIDY_HOLDER_ADDRESS_MAINNET]
        )

        // Check logs
        const receipt = await tx!.then((tx) => tx.wait())
        const [log] = await account.queryFilter(
          account.filters.FundsWithdrawal(),
          receipt.blockNumber,
          receipt.blockNumber
        )

        expect(log.args.principalFactor).to.be.gte(MANTISSA)

        // Check principal was correctly taxed
        const expectedPrincipalTaxBN = redeemAmountBN.mul(PRINCIPAL_TAX).div(MANTISSA)
        expect(parseUnits(subsidyBalanceDelta.toString(), principalToken.decimals))
          .to.be.gte(expectedPrincipalTaxBN.sub(expectedPrincipalTaxBN.div(ERROR_TOLERANCE)))
          .and.lte(expectedPrincipalTaxBN.add(expectedPrincipalTaxBN.div(ERROR_TOLERANCE)))
      })

      it('works with collateral usage factor > 1 (bad debt, position value = 0)', async () => {
        await compoundPriceOracleMock.setPriceUpdate(principalCToken.address, parseUnits('0.1')) // -90% price on principal tokenç

        // Check context aligns with test
        const { collateralUsageFactor, positionValue } = await account.callStatic.getPositionMetadata()
        expect(collateralUsageFactor).to.be.gt(MANTISSA)
        expect(positionValue).to.be.eq(0)

        // Prepare to repay debt
        const debt = await account.callStatic.getBorrowBalance()
        await sendToken(borrowToken, alice.address, debt.mul(2))
        await borrowToken.contract.connect(alice).approve(account.address, ethers.constants.MaxUint256)

        // Withdraw amount
        const redeemAmountBN = supplyAmountBN.div(2)

        let tx: Promise<ContractTransaction>
        // Fetch balance changes
        const [aliceBalanceDelta, subsidyBalanceDelta] = await getBalanceDeltas(
          () => {
            tx = account
              .connect(alice)
              .decreaseSimplePositionWithFunds(
                platform,
                principalToken.address,
                redeemAmountBN,
                borrowToken.address,
                debt
              )

            return tx
          },
          principalToken,
          [alice.address, SUBSIDY_HOLDER_ADDRESS_MAINNET]
        )

        // Check logs
        const receipt = await tx!.then((tx) => tx.wait())
        const [log] = await account.queryFilter(
          account.filters.FundsWithdrawal(),
          receipt.blockNumber,
          receipt.blockNumber
        )

        expect(log.args.principalFactor).to.be.eq(MANTISSA)

        // Check principal was correctly taxed
        const expectedPrincipalTaxBN = redeemAmountBN.mul(PRINCIPAL_TAX).div(MANTISSA)
        expect(parseUnits(subsidyBalanceDelta.toString(), principalToken.decimals))
          .to.be.gte(expectedPrincipalTaxBN.sub(expectedPrincipalTaxBN.div(ERROR_TOLERANCE)))
          .and.lte(expectedPrincipalTaxBN.add(expectedPrincipalTaxBN.div(ERROR_TOLERANCE)))
      })

      it('correctly returns subsidy, principal share and profit share', async () => {
        const _account = await impersonateAndFundWithETH(account.address)
        await sendToken(principalToken, account.address, supplyAmountBN)
        const { principalShare, profitShare, subsidy } = await account
          .connect(_account)
          .callStatic.withdraw(principalAmountBN, principalAmountBN)

        // Check profit and principal were correctly taxed

        const expectedPrincipalTaxBN = principalAmountBN.mul(PRINCIPAL_TAX).div(MANTISSA)

        expect(profitShare).to.be.eq(0)
        expect(principalShare).to.be.closeTo(principalAmountBN, principalAmountBN.div(ERROR_TOLERANCE))
        expect(subsidy).to.be.closeTo(expectedPrincipalTaxBN, expectedPrincipalTaxBN.div(ERROR_TOLERANCE))
      })
    })

    it('rejects if called by external address', async () => {
      const withdrawAmount = Math.floor(Math.random() * 10000)
      const positionValue = Math.floor(Math.random() * 10000)
      await expect(account.connect(mallory).withdraw(withdrawAmount, positionValue)).to.be.revertedWith(
        'NOT_AUTHORIZED'
      )
    })
  })
})

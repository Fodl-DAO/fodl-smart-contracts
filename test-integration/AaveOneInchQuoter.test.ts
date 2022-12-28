import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { FeeAmount } from '@uniswap/v3-sdk'
import { formatUnits, parseEther } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'

import { recodeOneInchQuote } from '../utils/recodeOneInchQuote'
import { IQuoterV2, AaveOneInchQuoter, QuoterV2 } from '../typechain'

import { IOneInchResponse, PROTOCOL, queryOneInch } from './utils/RouteFinders'
import { USDC, WETH } from '../constants/tokens'

const MANTISSA = BigNumber.from(10).pow(18)

describe('AaveOneInchQuoter', () => {
  let oneInchQuoter: AaveOneInchQuoter
  let uniswapV3Quoter: IQuoterV2
  let oneInchArtifact: IOneInchResponse

  beforeEach('fixture', async () => {
    await deployments.fixture()

    oneInchQuoter = (await ethers.getContract('AaveOneInchQuoter')) as AaveOneInchQuoter
    uniswapV3Quoter = (await ethers.getContract('QuoterV2')) as QuoterV2
  })

  const tokenIn = WETH.address
  const tokenOut = USDC.address

  const amountInBase = parseEther('100')

  it('correctly quotes uniswap V2 routes', async () => {
    const protocols: PROTOCOL = PROTOCOL.UNISWAP_V2

    oneInchArtifact = await queryOneInch(tokenIn, tokenOut, amountInBase, protocols, { linear: false })

    const inputAmount = parseEther('1')

    const { amountOut: expectedQuotedAmount } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: inputAmount,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    await oneInchQuoter.callStatic.quote(inputAmount, oneInchArtifact.tx.data)
    const oneInchQuoteAmount = await oneInchQuoter.callStatic.quote(inputAmount, oneInchData)

    expect(oneInchQuoteAmount) // Expect one inch quote amount to be within +-20% of spot price
      .to.be.gte(expectedQuotedAmount.mul(80).div(100))
      .and.lte(expectedQuotedAmount.mul(120).div(100))
  })

  it('correctly quotes uniswap V3 routes', async () => {
    const protocols: PROTOCOL = PROTOCOL.UNISWAP_V3

    oneInchArtifact = await queryOneInch(tokenIn, tokenOut, amountInBase, protocols, { linear: false })

    const inputAmount = parseEther('1')

    const { amountOut: expectedQuotedAmount } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: inputAmount,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const oneInchQuoteAmount = await oneInchQuoter.callStatic.quote(inputAmount, oneInchData)

    const { amountOut: uniswapV3QuoteAmount } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: inputAmount,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    expect(oneInchQuoteAmount) // Expect one inch quote amount to be within +-20% of spot price
      .to.be.gte(expectedQuotedAmount.mul(80).div(100))
      .and.lte(expectedQuotedAmount.mul(120).div(100))
    expect(oneInchQuoteAmount).to.be.gt(uniswapV3QuoteAmount) // Expect one inch quote to have better slippage than a simple swap
  })

  it('correctly quotes curve routes', async () => {
    const protocols: PROTOCOL[] = [PROTOCOL.CURVE, PROTOCOL.CURVE_V2]

    oneInchArtifact = await queryOneInch(tokenIn, tokenOut, amountInBase, protocols, { linear: false })

    const inputAmount = parseEther('1')

    const { amountOut: expectedQuotedAmount } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: inputAmount,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const oneInchQuoteAmount = await oneInchQuoter.callStatic.quote(inputAmount, oneInchData)

    expect(oneInchQuoteAmount) // Expect one inch quote amount to be within +-20% of spot price
      .to.be.gte(expectedQuotedAmount.mul(80).div(100))
      .and.lte(expectedQuotedAmount.mul(120).div(100))
  })

  it('correctly quotes balancer routes', async () => {
    const protocols: PROTOCOL = PROTOCOL.BALANCER

    oneInchArtifact = await queryOneInch(tokenIn, tokenOut, amountInBase, protocols, { linear: false })
    const inputAmount = parseEther('1')

    const { amountOut: uniswapV3Price } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: parseEther('1'),
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const expectedQuotedAmount = uniswapV3Price.mul(inputAmount).div(MANTISSA)

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const oneInchQuoteAmount = await oneInchQuoter.callStatic.quote(inputAmount, oneInchData)

    expect(oneInchQuoteAmount) // Expect one inch quote amount to be within +-20% of spot price
      .to.be.gte(expectedQuotedAmount.mul(80).div(100))
      .and.lte(expectedQuotedAmount.mul(120).div(100))
  })

  it('correctly quotes composed routes', async () => {
    const protocols: PROTOCOL[] = [
      PROTOCOL.UNISWAP_V2,
      PROTOCOL.UNISWAP_V3,
      PROTOCOL.SUSHI,
      PROTOCOL.CURVE,
      PROTOCOL.CURVE_V2,
      PROTOCOL.BALANCER,
    ]

    const inputAmount = amountInBase.mul(100)
    oneInchArtifact = await queryOneInch(tokenIn, tokenOut, inputAmount, protocols, { linear: false })

    const { amountOut: uniswapV3Price } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: parseEther('1'),
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const expectedQuotedAmount = uniswapV3Price.mul(inputAmount).div(MANTISSA)

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const oneInchQuoteAmount = await oneInchQuoter.callStatic.quote(inputAmount, oneInchData)

    const { amountOut: uniswapV3QuoteAmount } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: inputAmount,
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    expect(oneInchQuoteAmount) // Expect one inch quote amount to be within +-20% of spot price
      .to.be.gte(expectedQuotedAmount.mul(80).div(100))
      .and.lte(expectedQuotedAmount.mul(120).div(100))
    expect(oneInchQuoteAmount).to.be.gt(uniswapV3QuoteAmount) // Expect one inch quote to have better slippage than a simple swap
  })

  afterEach('log one inch data if failure', async function () {
    if (this.currentTest?.state != 'passed') {
      console.log('Test failed, printing one inch artifact')
      console.log(JSON.stringify(oneInchArtifact))
    }
  })
})

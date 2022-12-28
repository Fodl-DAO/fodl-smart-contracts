import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { FeeAmount } from '@uniswap/v3-sdk'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import { deployments, ethers } from 'hardhat'
import {
  ONE_INCH_WETH_TO_USDC_UNOSWAP_RESPONSE,
  ONE_INCH_WETH_TO_USDC_UNISWAPV3_RESPONSE,
  ONE_INCH_WETH_TO_USDC_CURVE_RESPONSE,
  ONE_INCH_WETH_TO_DAI_BALANCER_RESPONSE,
  ONE_INCH_WETH_TO_DAI_RESPONSE,
  ONE_INCH_RESPONSE_WETH_TO_USDC_SINGLE_HOP,
  ONE_INCH_RESPONSE_USDT_TO_WETH_SAFETRANSFER,
  ONE_INCH_RESPONSE_WETH_TO_USDT,
  ONE_INCH_RESPONSE_USDC_TO_USDT_NO_LEFTOVERS,
} from './shared/OneInchResponses'
import { recodeOneInchQuote } from '../utils/recodeOneInchQuote'
import { IQuoterV2, AaveOneInchQuoter, QuoterV2 } from '../typechain'

import { cloneDeep } from 'lodash'

const MANTISSA = BigNumber.from(10).pow(18)

describe('AaveOneInchQuoter', () => {
  let oneInchQuoter: AaveOneInchQuoter
  let uniswapV3Quoter: IQuoterV2

  beforeEach('fixture', async () => {
    await deployments.fixture()

    oneInchQuoter = (await ethers.getContract('AaveOneInchQuoter')) as AaveOneInchQuoter
    uniswapV3Quoter = (await ethers.getContract('QuoterV2')) as QuoterV2
  })

  it('correctly quotes uniswap V2 routes', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_WETH_TO_USDC_UNOSWAP_RESPONSE)
    const inputAmount = parseEther('1')

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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
    const oneInchArtifact = cloneDeep(ONE_INCH_WETH_TO_USDC_UNISWAPV3_RESPONSE)
    const inputAmount = parseEther('1')

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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

  it('correctly quotes uniswap V3 routes with a single hop', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_RESPONSE_WETH_TO_USDC_SINGLE_HOP)
    const inputAmount = parseEther('1')

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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

  it('correctly quotes curve routes', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_WETH_TO_USDC_CURVE_RESPONSE)
    const inputAmount = parseEther('1')

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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

  /**
   * Balancer is too dependant on block number, reserving this for integration tests
   */
  it.skip('correctly quotes balancer routes', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_WETH_TO_DAI_BALANCER_RESPONSE)
    const inputAmount = BigNumber.from(oneInchArtifact.fromTokenAmount).div(100)

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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
    const oneInchArtifact = cloneDeep(ONE_INCH_WETH_TO_DAI_RESPONSE)

    const inputAmount = BigNumber.from(oneInchArtifact.fromTokenAmount).div(100)

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

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

  it('correctly quotes routes with non-compliant ERC20 input', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_RESPONSE_USDT_TO_WETH_SAFETRANSFER)

    const inputAmount = BigNumber.from(oneInchArtifact.fromTokenAmount).div(100)

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const { amountOut: uniswapV3Price } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: parseUnits('1', oneInchArtifact.fromToken.decimals),
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const expectedQuotedAmount = uniswapV3Price
      .mul(inputAmount)
      .div(BigNumber.from(10).pow(oneInchArtifact.fromToken.decimals))

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

  it('correctly quotes with non-compliant ERC20 as output', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_RESPONSE_WETH_TO_USDT)

    const inputAmount = BigNumber.from(oneInchArtifact.fromTokenAmount).div(100)

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const { amountOut: uniswapV3Price } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: parseUnits('1', oneInchArtifact.fromToken.decimals),
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const expectedQuotedAmount = uniswapV3Price
      .mul(inputAmount)
      .div(BigNumber.from(10).pow(oneInchArtifact.fromToken.decimals))

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

  it('correctly quotes artifacts without leftovers action', async () => {
    const oneInchArtifact = cloneDeep(ONE_INCH_RESPONSE_USDC_TO_USDT_NO_LEFTOVERS)

    const inputAmount = BigNumber.from(oneInchArtifact.fromTokenAmount).div(100)

    const tokenIn = oneInchArtifact.fromToken.address
    const tokenOut = oneInchArtifact.toToken.address

    const { modifiedPayloadWithSelector: oneInchData } = recodeOneInchQuote(
      oneInchArtifact,
      inputAmount,
      oneInchQuoter.address
    )

    const { amountOut: uniswapV3Price } = await uniswapV3Quoter.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: parseUnits('1', oneInchArtifact.fromToken.decimals),
      fee: FeeAmount.MEDIUM,
      sqrtPriceLimitX96: 0,
    })

    const expectedQuotedAmount = uniswapV3Price
      .mul(inputAmount)
      .div(BigNumber.from(10).pow(oneInchArtifact.fromToken.decimals))

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
})

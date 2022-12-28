import { BigNumber, ethers } from 'ethers'
import { cloneDeep } from 'lodash'
import { AaveOneInchQuoter } from '../typechain'
import { recodeOneInchQuote } from './recodeOneInchQuote'

export async function reverseExactInQuote(
  initialAmountIn: BigNumber,
  minAmountOut: BigNumber,
  quoter: AaveOneInchQuoter,
  baseOneInchArtifact: any,
  { maxAmountIn = ethers.constants.MaxUint256 } = {}
) {
  const quote = quoter.callStatic.quote
  let artifact = recodeOneInchQuote(
    cloneDeep(baseOneInchArtifact),
    initialAmountIn,
    quoter.address
  ).modifiedPayloadWithSelector

  let amountIn = BigNumber.from(initialAmountIn.toString())
  let amountOut: BigNumber = BigNumber.from(0)
  for (;;) {
    amountOut = await quote(amountIn, artifact)
    if (amountOut.gte(minAmountOut)) break
    amountIn = amountIn.mul(1005).div(1000)
    if (amountIn.gt(maxAmountIn)) throw new Error(`Exceeded maxAmountIn`)
    artifact = recodeOneInchQuote(baseOneInchArtifact, amountIn, quoter.address).modifiedPayloadWithSelector
  }

  return { amountIn, amountOut }
}

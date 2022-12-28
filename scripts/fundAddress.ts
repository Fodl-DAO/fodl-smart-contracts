import { isAddress } from '@ethersproject/address'
import { BETH, BSCDAI, BSCUSDC, BSCUSDT, BTCB, DAI, FODL, POLY, USDC, USDT, WBTC, WETH } from '../constants/tokens'
import { sendToken } from '../scripts/utils'
import { float2SolidityTokenAmount } from '../test/shared/utils'

const supportedTokens = {
  ETHEREUM: {
    USDC: USDC,
    DAI: DAI,
    WBTC: WBTC,
    WETH: WETH,
    USDT: USDT,
    FODL: FODL,
  },
  BINANCE: {
    USDC: BSCUSDC,
    DAI: BSCDAI,
    WBTC: BTCB,
    WETH: BETH,
    USDT: BSCUSDT,
  },
  POLYGON: {
    USDC: POLY.USDC(),
    DAI: POLY.DAI(),
    WBTC: POLY.WBTC(),
    WETH: POLY.WETH(),
    USDT: POLY.USDT(),
  },
}

function fetchTokenDataByName(chain: string, tokenName: string) {
  tokenName = tokenName.toUpperCase().trim()
  if (!Object.keys(supportedTokens).includes(chain)) throw new Error(`Chain ${chain} is not supported`)
  if (!Object.keys(supportedTokens[chain]).includes(tokenName)) throw new Error(`Unavailable token name ${tokenName}`)
  return supportedTokens[chain][tokenName]
}

async function main(): Promise<any> {
  const tokenName = process.env.TOKEN
  const recipient = process.env.RECIPIENT
  const chain = process.env.CHAIN?.toUpperCase() || 'ETHEREUM'
  const amount = parseFloat(process.env.AMOUNT || '0')

  if (!tokenName || !recipient || !amount) throw new Error(`Missing inputs`)
  if (!isAddress(recipient)) throw new Error(`${recipient} is not a valid ETH address`)
  const token = fetchTokenDataByName(chain, tokenName)
  await sendToken(token.contract, recipient, float2SolidityTokenAmount(token, amount))
  console.log(`[SUCCESS] Sent ${amount} ${token.symbol} (${token.address}) to ${recipient}`)
}

main()
  .catch(console.error)
  .finally(() => process.exit(0))

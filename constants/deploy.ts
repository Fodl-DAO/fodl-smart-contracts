import { ChainId } from '@sushiswap/sdk'
import { BigNumber } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import {
  ADA,
  BAT,
  BCH,
  BETH,
  BSCDAI,
  BSCETH,
  BSCUSDC,
  BSCUSDT,
  BTCB,
  BUSD,
  CAKE,
  cBAT,
  cCOMP,
  cDAI,
  cETH,
  cLINK,
  COMP,
  cTUSD,
  cUNI,
  cUSDC,
  cUSDT,
  cWBTC2,
  cZRX,
  DAI,
  DOGE,
  DOT,
  LINK,
  LTC,
  POLY,
  SXP,
  TUSD,
  UNI,
  USDC,
  USDT,
  vADA,
  vBCH,
  vBETH,
  vBNB,
  vBTC,
  vBUSD,
  vCAKE,
  vDAI,
  vDOGE,
  vDOT,
  vETH,
  vLTC,
  vSXP,
  vUSDC,
  vUSDT,
  vXRP,
  vXVS,
  WBNB,
  WBTC,
  WETH,
  XRP,
  XVS,
  ZRX,
} from './tokens'

export const ERC721_NAME = 'TEST_NAME'
export const ERC721_SYMBOL = 'TEST'

export const LP_USDC_FODL_STAKING_ADDRESS = '0xF958a023d5B1e28c32373547bDdE001cAD17E9B4'
export const LP_ETH_FODL_STAKING_ADDRESS = '0xA7453338ccc29E4541e6C6B0546A99Cc6b9EB09a'
export const FIRST_LP_STAKING_REWARD_INDEX = 6
export const STAKING_TREASURY_ADDRESS = '0xaA2312935201146555078E2a6C0B0FeaAEE43452'
export const SSS_REWARDS_START_TIME = 1638338400 // 1st December 6am
export const SUBSIDY_HOLDER_ADDRESS_MAINNET = '0x95725e8D2f9Fca1A122296F366F0DEEdaBE6d88A' // mainnet tax address
export const SUBSIDY_HOLDER_ADDRESS_BSC = '0x7e05540A61b531793742fde0514e6c136b5fbAfE' // bsc tax address
export const SUBSIDY_HOLDER_ADDRESS_POLYGON = '0x741dc35685325c73b6f6c6ccf69363acf1f59517' // bsc tax address
export const SUBSIDY_PROFIT = BigNumber.from(0)
export const SUBSIDY_PRINCIPAL = parseUnits('0.001', 18)
export const SUBSIDY_REWARDS = BigNumber.from(0)

export const FODL_TOKEN_INITIAL_AMOUNT = parseUnits('1000000000', 18)

export const FODL_NFT_NAME = 'FODL Positions'
export const FODL_NFT_SYMBOL = 'FODL-POS'
export const FODL_BSC_ADDRESS = '0x43f5b29D63ceDC5a7c1724dbB1D698FDe05Ada21'
export const FODL_POLYGON_ADDRESS = '0x5314bA045a459f63906Aa7C76d9F337DcB7d6995'

export const ONE_DAY_SECONDS = 24 * 60 * 60
export const STAKING_EPOCH_DURATION_SEC = 7 * ONE_DAY_SECONDS
export const REWARDS_TAXING_PERIOD_SECONDS = 365 * ONE_DAY_SECONDS

export const COMPOUND_PLATFORM = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B'
export const COMPOUND_TOKENS_TO_CTOKENS = {
  [USDC.address]: cUSDC.address,
  [DAI.address]: cDAI.address,
  [WETH.address]: cETH.address,
  [WBTC.address]: cWBTC2.address,
  [USDT.address]: cUSDT.address,
  [UNI.address]: cUNI.address,
  [COMP.address]: cCOMP.address,
  [TUSD.address]: cTUSD.address,
  [ZRX.address]: cZRX.address,
  [LINK.address]: cLINK.address,
  [BAT.address]: cBAT.address,
}

export const VENUS_PLATFORM = '0xfD36E2c2a6789Db23113685031d7F16329158384'
export const VENUS_TOKENS_TO_VTOKENS = {
  [WBNB.address]: vBNB.address,
  [BUSD.address]: vBUSD.address,
  [BSCUSDC.address]: vUSDC.address,
  [BSCUSDT.address]: vUSDT.address,
  [XVS.address]: vXVS.address,
  [BSCDAI.address]: vDAI.address,
  [BTCB.address]: vBTC.address,
  [BSCETH.address]: vETH.address,
  [BETH.address]: vBETH.address,
  [XRP.address]: vXRP.address,
  [ADA.address]: vADA.address,
  [LTC.address]: vLTC.address,
  [BCH.address]: vBCH.address,
  [DOGE.address]: vDOGE.address,
  [DOT.address]: vDOT.address,
  [SXP.address]: vSXP.address,
  [CAKE.address]: vCAKE.address,
}

export const INVERSE_PLATFORM = '0x4dCf7407AE5C07f8681e1659f626E114A7667339'
export const INVERSE_TOKENS_TO_CTOKENS = {}

export const CREAM_PLATFORM = '0x3d5BC3c8d13dcB8bF317092d84783c2697AE9258'
export const CREAM_TOKENS_TO_CTOKENS = {}

export const AAVE_PLATFORM = '0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5'
export const AAVE_PLATFORM_DATA_PROVIDER = '0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d'
export const AAVE_PLATFORM_INCENTIVES_CONTROLLER = '0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5'

export const AAVE_PLATFORM_POLYGON = '0xd05e3E715d945B59290df0ae8eF85c1BdB684744'
export const AAVE_PLATFORM_DATA_PROVIDER_POLYGON = '0x7551b5D2763519d4e37e8B81929D336De671d46d'
export const AAVE_PLATFORM_INCENTIVES_CONTROLLER_POLYGON = '0x357D51124f59836DeD84c8a1730D72B749d8BC23'

export const ONE_INCH_EXCHANGE = '0x11111112542d85b3ef69ae05771c2dccff4faa26'

export const UNI_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
export const UNI_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'
export const UNI_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'
export const UNI_V3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'
export const UNI_V3_QUOTERV2 = '0x0209c4Dc18B2A1439fD2427E34E7cF3c6B91cFB9'
export const SUSHI_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F'

export const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E'
export const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73'
export const QUICKSWAP_ROUTER = '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff'

export const DYDX_SOLO = '0x1E0447b19BB6EcFdAe1e4AE1694b0C3659614e4e'

/**
 * Flags to use Uniswap or 1inch when swapping flash loans
 */

export const USE_ONEINCH_EXCHANGE = '0x00'
export const USE_UNISWAP_EXCHANGE = '0x01'
export const USE_SUSHISWAP_EXCHANGE = '0x02'
export const USE_PANCAKESWAP_EXCHANGE = '0x11'
export const USE_QUICKSWAP_EXCHANGE = '0x20'
export const USE_CONTROLLED_EXCHANGE = '0xff'

export const TOKEN_URI_SIGNER_ADDRESS = '0x7E771C0DB0233f8f06361a7FAa9B7637E0bd39F4'

export const GOVERNANCE_MIN_DELAY = ONE_DAY_SECONDS
export const GOVERNANCE_MIN_REQUIRED = 4
export const GOVERNANCE_MULTISIG_OWNERS = [
  '0x85630cd831AfC74AD3c90024CF4F15A187768da0',
  '0xF00db2BDc61BaD6C404e55767d4dad696F07bB3b',
  '0x2969E2042a3836B077e6d7C58e41d58f66c4455b',
  '0xE150fEf6CDc4DB5168Ae3c85b74e442542d51de5',
  '0x656cc850ae2288D8bd31E231c3CE8Ce2C6bf1332',
  '0xff5039700e8f404a58c1d259ea5b722fedc280e5',
]

/**
 * 1inch spot price oracles - https://github.com/1inch/spot-price-aggregator
 */

export const ONE_INCH_SPOT_PRICE_ORACLES = {
  [ChainId.MAINNET]: '0x07D91f5fb9Bf7798734C3f606dB065549F6893bb',
  [ChainId.MATIC]: '0x7F069df72b7A39bCE9806e3AfaF579E54D8CF2b9',
}

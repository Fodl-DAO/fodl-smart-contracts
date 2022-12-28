import { AbiCoder } from '@ethersproject/abi'
import { isHexString } from '@ethersproject/bytes'
import { BigNumber } from 'ethers'
import { hexZeroPad, isAddress } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import { cloneDeep } from 'lodash'

const UNOSWAP_FUNCTION_SELECTOR = '2e95b6c8'
const SWAP_FUNCTION_SELECTOR = '7c025200'

const TRANSFER_ACTION_SELECTOR = 'a9059cbb'
const SAFE_TRANSFER_ACTION_SELECTOR = 'd1660f99'
const SAFE_APPROVE_ACTION_SELECTOR = 'eb5625d9'
const UNISWAP_V3_SWAP_ACTION_SELECTOR = '128acb08'
const INTERNAL_CALL_ACTION_SELECTOR = 'b3af37c0'
const LEFTOVER_CHECK_ACTION_SELECTOR = '7f8fe7a0'
const CAP_ACTION_SELECTOR = '70bdb947'

const SLOT_LENGTH = 64
const CUSTOM_DATA_LENGTH = 8

const DST_RECEIVER_OFFSET = SLOT_LENGTH * 6
const INPUT_AMT_OFFSET = SLOT_LENGTH * 7
const CALLBYTES_LENGTH_OFFSET = SLOT_LENGTH * 14
const CALLBYTES_OFFSET = SLOT_LENGTH * 15

interface IOneInchResponseParam {
  fromTokenAmount: string | BigNumber
  tx: {
    data: string
  }
}

type CapParameters = [string, BigNumber]

export function recodeOneInchQuote<T extends IOneInchResponseParam>(
  oneInchTxResponse: T,
  amountIn: string | BigNumber,
  recipient?: string
) {
  const _oneInchTxResponse = cloneDeep(oneInchTxResponse)
  if (!isHexString(_oneInchTxResponse.tx.data)) throw new Error(`Not an hex string: ${_oneInchTxResponse.tx.data}`)

  let { fromTokenAmount } = _oneInchTxResponse
  if (typeof fromTokenAmount === 'string') fromTokenAmount = BigNumber.from(fromTokenAmount)
  if (typeof amountIn === 'string') amountIn = BigNumber.from(amountIn)

  const bytes = detach0xPrefix(_oneInchTxResponse.tx.data).toLowerCase()
  const functionSelector = bytes.substring(0, 8).toLowerCase()
  const payload = bytes.substring(8).toLowerCase()

  let modifiedPayloadWithSelector: string

  switch (functionSelector) {
    case SWAP_FUNCTION_SELECTOR:
      modifiedPayloadWithSelector = recodeSwapData({ amountIn, payload, fromTokenAmount, recipient })
      break
    case UNOSWAP_FUNCTION_SELECTOR:
      modifiedPayloadWithSelector = recodeUnoSwapData({ amountIn, payload, fromTokenAmount })
      break
    default:
      throw new Error(`Unknown function selector: ${functionSelector}`)
  }

  let ret = _oneInchTxResponse
  ret.tx.data = modifiedPayloadWithSelector

  return {
    oneInchTxResponse: ret,
    modifiedPayloadWithSelector,
    modifiedPayload: '0x' + detach0xPrefix(modifiedPayloadWithSelector).substring(8),
  }
}

function recodeSwapData(params: {
  amountIn: BigNumber
  fromTokenAmount: BigNumber
  payload: string
  recipient?: string
}) {
  const inputAmountBytes = params.payload.substring(INPUT_AMT_OFFSET, INPUT_AMT_OFFSET + SLOT_LENGTH)
  const inputAmountBN = BigNumber.from(`0x${inputAmountBytes}`)

  if (!inputAmountBN.eq(params.fromTokenAmount)) {
    const errMsg = `Invariants failed: fromTokenAmount ${params.fromTokenAmount.toString()} differs from coded inputAmount ${inputAmountBN.toString()} in tx.data payload`
    throw new Error(errMsg)
  }

  const callBytesLengthBytes = params.payload.substring(CALLBYTES_LENGTH_OFFSET, CALLBYTES_LENGTH_OFFSET + SLOT_LENGTH)
  const callBytesLength = BigNumber.from(`0x${callBytesLengthBytes}`).toNumber()

  if (callBytesLength === 1) return recodeSingleActionSwapData(params)
  else return recodeMultiActionSwapData(params, callBytesLength)
}

function recodeMultiActionSwapData(
  params: {
    amountIn: BigNumber
    fromTokenAmount: BigNumber
    payload: string
    recipient?: string
  },
  callBytesLength: number
) {
  const callBytes = params.payload.slice(CALLBYTES_OFFSET, -CUSTOM_DATA_LENGTH)

  ///////////////////////////////////////////////////////////////////
  // This first block of code rebases the input amount
  // inside the 1inch tx data and replaces it for the
  // desired amount in params.amountIn
  ///////////////////////////////////////////////////////////////////

  const FIRST_ACTION_OFFSET = BigNumber.from(`0x${callBytes.slice(0, SLOT_LENGTH)}`).toNumber() * 2
  const SECOND_ACTION_OFFSET = BigNumber.from(`0x${callBytes.slice(SLOT_LENGTH, SLOT_LENGTH * 2)}`).toNumber() * 2

  const firstActionBytes = callBytes.substring(FIRST_ACTION_OFFSET, SECOND_ACTION_OFFSET)
  const firstActionPayload = extractActionPayload(firstActionBytes)

  const firstActionSelector = firstActionPayload.substring(0, 8)
  const firstActionArgs = firstActionPayload.substring(8)

  let baseInputAmount: BigNumber
  switch (firstActionSelector) {
    case TRANSFER_ACTION_SELECTOR:
      baseInputAmount = extractBaseAmountFromTransferAction(firstActionArgs)
      break
    case SAFE_TRANSFER_ACTION_SELECTOR:
      baseInputAmount = extractBaseAmountFromSafeTransferAction(firstActionArgs)
      break
    case SAFE_APPROVE_ACTION_SELECTOR:
      baseInputAmount = extractBaseAmountFromSafeApproveTransferAction(firstActionArgs)
      break
    case UNISWAP_V3_SWAP_ACTION_SELECTOR:
      baseInputAmount = extractBaseAmountFromUniswapV3Swap(firstActionArgs)
      break
    default:
      throw new Error(`First action selector unknown: ${firstActionSelector}`)
  }

  // Replace the base input amount with the proportional new amount
  // Note that we do not change params.fromTokenAmount in tx.data, this is because the quoter does it by itself,
  // but maybe this would need to be done for cache and other operations
  const newBaseInputAmount: BigNumber = params.amountIn.mul(baseInputAmount).div(params.fromTokenAmount)
  const valueToReplace = detach0xPrefix(hexZeroPad(baseInputAmount.toHexString(), 32))
  const replacementValue = detach0xPrefix(hexZeroPad(newBaseInputAmount.toHexString(), 32))

  params.payload = params.payload.replace(new RegExp(valueToReplace, 'g'), replacementValue)

  ///////////////////////////////////////////////////////////////////
  // This second block of code looks for a potential cap
  // inside the 1inch tx data and removes it
  ///////////////////////////////////////////////////////////////////
  const LEFTOVERS_ACTION_OFFSET =
    BigNumber.from(
      `0x${callBytes.substring(SLOT_LENGTH * (callBytesLength - 2), SLOT_LENGTH * (callBytesLength - 1))}`
    ).toNumber() * 2
  const LAST_ACTION_OFFSET =
    BigNumber.from(
      `0x${callBytes.slice(SLOT_LENGTH * (callBytesLength - 1), SLOT_LENGTH * callBytesLength)}`
    ).toNumber() * 2

  if (params.payload.includes(LEFTOVER_CHECK_ACTION_SELECTOR) && params.payload.includes(CAP_ACTION_SELECTOR)) {
    // console.log(`0x${callBytes.substring(SLOT_LENGTH * (callBytesLength - 2), SLOT_LENGTH * (callBytesLength - 1))}`)
    // console.log('leftovers offset', LEFTOVERS_ACTION_OFFSET.toString(16))

    const leftOversActionBytes = callBytes.substring(LEFTOVERS_ACTION_OFFSET, LAST_ACTION_OFFSET)
    const leftOversActionPayload = extractActionPayload(leftOversActionBytes)

    if (leftOversActionPayload.substring(0, 8) !== LEFTOVER_CHECK_ACTION_SELECTOR)
      throw new Error(`Unexpected left overs position, printing 1inch 's tx response ${params.payload}`)

    const capParameters = extractCapActionParametersFromLeftOversActionPayload(leftOversActionPayload)
    const modifiedLeftOversActionPayload = uncapLeftOversActionPayload(leftOversActionPayload, capParameters)

    params.payload = params.payload.replace(leftOversActionPayload, modifiedLeftOversActionPayload)
  }

  ///////////////////////////////////////////////////////////////////
  // The third block of code replaces the recipient
  // inside the 1inch tx data if it has been specified
  ///////////////////////////////////////////////////////////////////
  if (params.recipient) {
    const lastActionBytes = callBytes.slice(LAST_ACTION_OFFSET)
    const lastActionPayload = extractActionPayload(lastActionBytes)

    const modifiedLastActionPayload = replaceFundsRecipient(lastActionPayload, params.recipient)

    params.payload = params.payload.replace(lastActionPayload, modifiedLastActionPayload)

    params.payload =
      params.payload.substring(0, DST_RECEIVER_OFFSET) +
      detach0xPrefix(hexZeroPad(params.recipient, 32)) +
      params.payload.substring(DST_RECEIVER_OFFSET + SLOT_LENGTH)
  }

  let ret = '0x'
  ret += SWAP_FUNCTION_SELECTOR
  ret += params.payload

  return ret
}

function recodeSingleActionSwapData(params: {
  amountIn: BigNumber
  fromTokenAmount: BigNumber
  payload: string
  recipient?: string
}) {
  const callBytes = params.payload.slice(CALLBYTES_OFFSET, -CUSTOM_DATA_LENGTH)

  const FIRST_ACTION_OFFSET = BigNumber.from(`0x${callBytes.slice(0, SLOT_LENGTH)}`).toNumber() * 2

  const firstActionBytes = callBytes.substring(FIRST_ACTION_OFFSET)

  const firstActionPayload = extractActionPayload(firstActionBytes)
  const firstActionSelector = firstActionPayload.substring(0, 8)
  const firstActionArgs = firstActionPayload.substring(8)

  if (firstActionSelector != UNISWAP_V3_SWAP_ACTION_SELECTOR)
    throw new Error(`Action selector unknown: ${firstActionSelector}`)

  const reencodedUniswapV3Args = reencodeInputAmountAndRecipientFromUniswapV3Swap(
    firstActionArgs,
    params.amountIn,
    params.recipient
  )

  params.payload = params.payload.replace(new RegExp(firstActionArgs, 'g'), reencodedUniswapV3Args)
  if (params.recipient) {
    params.payload =
      params.payload.substring(0, DST_RECEIVER_OFFSET) +
      detach0xPrefix(hexZeroPad(params.recipient, 32)) +
      params.payload.substring(DST_RECEIVER_OFFSET + SLOT_LENGTH)
  }

  let ret = '0x'
  ret += SWAP_FUNCTION_SELECTOR
  ret += params.payload

  return ret
}

function recodeUnoSwapData(params: {
  amountIn: BigNumber
  fromTokenAmount: BigNumber
  payload: string
  recipient?: string
}) {
  const abiCoder = new AbiCoder()
  params.payload = detach0xPrefix(params.payload)

  const UNOSWAP_CALLDATA_TYPES = ['address', 'uint256', 'uint256', 'bytes32[]']

  let args = abiCoder.decode(UNOSWAP_CALLDATA_TYPES, '0x' + params.payload)

  const inputAmounBN = BigNumber.from(args[1])
  const minReturnAmount = BigNumber.from(args[2])
  if (!inputAmounBN.eq(params.fromTokenAmount))
    throw new Error(`Invariants failed: fromTokenAmount differs from coded inputAmount in tx.data payload`)

  const minReturnAmountModified = minReturnAmount.mul(params.amountIn).div(params.fromTokenAmount)

  const modifiedPayload = abiCoder.encode(UNOSWAP_CALLDATA_TYPES, [
    args[0],
    params.amountIn,
    minReturnAmountModified,
    args[3],
  ])

  let ret = '0x'
  ret += UNOSWAP_FUNCTION_SELECTOR
  ret += detach0xPrefix(modifiedPayload)

  return ret
}
function extractActionPayload(action: string) {
  if (action.substring(0, 2) != '0x') action = `0x${action}`
  return detach0xPrefix(new AbiCoder().decode(['uint256', 'uint256', 'uint256', 'bytes'], action)[3])
}

function extractBaseAmountFromTransferAction(actionBytes: string) {
  if (actionBytes.substring(0, 2) != '0x') actionBytes = `0x${actionBytes}`
  const result = new AbiCoder().decode(['address', 'uint256'], actionBytes)[1]
  if (!BigNumber.isBigNumber(result)) throw new Error(`AbiCoder.decode() error - Not a BigNumber: ${result}`)

  return result
}

function extractBaseAmountFromSafeTransferAction(actionBytes: string) {
  if (actionBytes.substring(0, 2) != '0x') actionBytes = `0x${actionBytes}`
  const result = new AbiCoder().decode(['address', 'address', 'uint256'], actionBytes)[2]
  if (!BigNumber.isBigNumber(result)) throw new Error(`AbiCoder.decode() error - Not a BigNumber: ${result}`)

  return result
}

function extractBaseAmountFromSafeApproveTransferAction(actionBytes: string) {
  if (actionBytes.substring(0, 2) != '0x') actionBytes = `0x${actionBytes}`
  const result = new AbiCoder().decode(['address', 'address', 'uint256'], actionBytes)[2]
  if (!BigNumber.isBigNumber(result)) throw new Error(`AbiCoder.decode() error - Not a BigNumber: ${result}`)

  return result
}

function extractBaseAmountFromUniswapV3Swap(actionBytes: string) {
  if (actionBytes.substring(0, 2) != '0x') actionBytes = `0x${actionBytes}`
  const result = new AbiCoder().decode(['address', 'bool', 'uint256', 'uint256', 'bytes'], actionBytes)[2]
  if (!BigNumber.isBigNumber(result)) throw new Error(`AbiCoder.decode() error - Not a BigNumber: ${result}`)

  return result
}

function reencodeInputAmountAndRecipientFromUniswapV3Swap(
  actionBytes: string,
  inputAmount: BigNumber,
  newRecipient?: string
) {
  if (actionBytes.substring(0, 2) != '0x') actionBytes = `0x${actionBytes}`
  if (newRecipient && !isAddress(newRecipient)) throw new Error(`Invalid new recipient: ${newRecipient}`)

  const typings = ['address', 'bool', 'uint256', 'uint256', 'bytes']
  let readings = new AbiCoder().decode(typings, actionBytes)

  if (!isAddress(readings[0])) throw new Error(`AbiCoder.decode() error - Not an address: ${readings[0]}`)
  if (!BigNumber.isBigNumber(readings[2])) throw new Error(`AbiCoder.decode() error - Not a BigNumber: ${readings[2]}`)

  let result: string

  result = new AbiCoder().encode(typings, [
    newRecipient ?? readings[0],
    readings[1],
    inputAmount,
    readings[3],
    readings[4],
  ])

  return detach0xPrefix(result)
}

function detach0xPrefix(str: string) {
  if (str.substring(0, 2).toLowerCase() === '0x') return str.slice(2)
  return str
}

function replaceFundsRecipient(actionBytes: string, newRecipient: string) {
  if (!isAddress(newRecipient)) throw new Error(`Invalid new recipient: ${newRecipient}`)
  actionBytes = detach0xPrefix(actionBytes)

  const actionSelector = actionBytes.substring(0, 8)

  if (actionSelector != INTERNAL_CALL_ACTION_SELECTOR) throw new Error(`Unexpected action selector: ${actionSelector}`)
  const actionArgs = '0x' + actionBytes.substring(8)

  const abiCoder = new AbiCoder()

  const INTERNAL_CALL_ABI_STRUCTURE = ['(uint256,uint256,uint256,bytes)', 'uint256', 'address', 'uint256']
  let [[flagsAndCallTo, gasLimit, value, transferAction], arg0, arg1, arg2] = abiCoder.decode(
    INTERNAL_CALL_ABI_STRUCTURE,
    actionArgs
  )
  const transferActionSelector = detach0xPrefix(transferAction).substring(0, 8)
  const transferActionPayload = detach0xPrefix(transferAction).substring(8)
  let transferActionModified: string

  switch (transferActionSelector) {
    case TRANSFER_ACTION_SELECTOR:
      transferActionModified =
        '0x' +
        transferActionSelector +
        detach0xPrefix(hexZeroPad(newRecipient, 32)) +
        transferActionPayload.substring(64)
      break
    case SAFE_TRANSFER_ACTION_SELECTOR:
      transferActionModified =
        '0x' +
        transferActionSelector +
        transferActionPayload.substring(0, 64) +
        detach0xPrefix(hexZeroPad(newRecipient, 32)) +
        transferActionPayload.substring(128)
      break
    default:
      throw new Error(`Unexpected final transfer selector: ${transferActionSelector}`)
  }

  const result =
    actionSelector +
    detach0xPrefix(
      abiCoder.encode(INTERNAL_CALL_ABI_STRUCTURE, [
        [flagsAndCallTo, gasLimit, value, transferActionModified],
        arg0,
        arg1,
        arg2,
      ])
    )

  return result
}

function extractCapActionParametersFromLeftOversActionPayload(actionBytes: string) {
  const index = actionBytes.indexOf(CAP_ACTION_SELECTOR)
  if (index === -1) throw new Error(`Could not find CAP_ACTION_SELECTOR ${CAP_ACTION_SELECTOR}`)

  let subActionBytes = actionBytes.substring(index + 8)

  if (subActionBytes.substring(0, 2) != '0x') subActionBytes = `0x${subActionBytes}`

  return new AbiCoder().decode(['address', 'uint'], subActionBytes) as CapParameters
}

function uncapLeftOversActionPayload(leftOversActionPayload: string, capParameters: CapParameters) {
  const address = detach0xPrefix(capParameters[0].toLowerCase())
  const cap = detach0xPrefix(hexZeroPad(capParameters[1].toHexString(), 32))

  const valueToReplace = address + cap
  const replacementValue = address + detach0xPrefix(ethers.constants.MaxUint256.toHexString())
  return leftOversActionPayload.replace(valueToReplace, replacementValue)
}

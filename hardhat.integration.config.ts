import config from './hardhat.config'

// This improves 1inch response and hardhat state so that less error happen due to differences between mainnet (1inch) state and forked state
if (!!config.networks?.hardhat?.forking?.blockNumber) config.networks.hardhat.forking.blockNumber = undefined

config.paths = {
  tests: 'test-integration',
}

config.mocha = {
  ...config.mocha,
  retries: Number(process.env.MOCHA_RETRIES) || 5, // Hardhat has troubles running EIP2535 in complex settings, see https://github.com/NomicFoundation/hardhat/issues/1904
}

export default config

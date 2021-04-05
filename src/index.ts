import { BigNumber } from 'bignumber.js'
import { Utils } from '@tacoinfra/harbinger-lib'
import { TezosToolkit } from '@taquito/taquito'
import { InMemorySigner } from '@taquito/signer'
import * as fs from 'fs'

/** Configuration Options */

// File to load containing airdrops
const DISTRIBUTION_FILE = 'airdrop.csv'

// How many transactions to include in a batch.
const TRANSACTIONS_PER_BATCH = 10

// The node to use. This determines the network the airdrop happens on.
const NODE_URL = 'https://rpctest.tzbeta.net'

// The contract address for the FA1.2 token.
const TOKEN_CONTRACT_ADDRESS = 'KT1...'

// How many confirmations to wait for on a transaction before proceeding. */
const CONFIRMATIONS = 3

/** End Configuration Options */
/** You should not need to edit below this line. */

/** An Airdrop that will occur */
type AirDrop = {
  address: string
  amount: string
}

/** An airdrop has been completed. */
type CompletedAirDrop = {
  address: string
  amount: string
  operationHash: string
}

// Load private key
const privateKeyName = 'AIRDROP_PRIVATE_KEY'
const privateKey = process.env[privateKeyName]
if (privateKey === undefined) {
  console.log('Fatal: No deployer private key defined.')
  console.log(`Set a ${privateKeyName} environment variable..`)
  process.abort()
}

/** Perform airdropping. */
const main = async () => {
  // Load a signer
  const tezos = new TezosToolkit(NODE_URL)
  const signer = new InMemorySigner(privateKey)
  tezos.setProvider({
    signer,
  })

  console.log(`> Parsing file: ${DISTRIBUTION_FILE}`)
  console.log(`> Using Node: ${NODE_URL}`)
  console.log(`> Deploying from: ${await signer.publicKeyHash()}`)
  console.log(`> Token Contract: ${TOKEN_CONTRACT_ADDRESS}`)
  console.log('')

  const drops: Array<AirDrop> = []
  fs.readFileSync(DISTRIBUTION_FILE, 'utf-8')
    .split(/\r?\n/)
    .forEach(function (line) {
      const split = line.split(',')
      const trimmed = split.map((input) => {
        return input.trim()
      })
      drops.push({
        address: trimmed[0],
        amount: trimmed[1],
      })
    })

  const total = drops.reduce((accumulated: BigNumber, next: AirDrop) => {
    return accumulated.plus(new BigNumber(next.amount))
  }, new BigNumber('0'))

  // Sanity Check
  console.log(`> About to distribute ${total.toFixed()} tokens`)
  console.log(`> In ${drops.length} airdrops`)
  console.log('> Sleeping for 120secs while you ponder that.')
  console.log('')
  console.log(
    '> You should CTRL+C the program *NOW* if the numbers do not look correct!',
  )
  await Utils.sleep(120)

  // Get contract
  const tokenContract = await tezos.contract.at(TOKEN_CONTRACT_ADDRESS)

  // Separate transactions into batches
  const numBatches = Math.ceil(drops.length / TRANSACTIONS_PER_BATCH)
  const batches: Array<Array<AirDrop>> = []
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[1]
    const batchIndex = i % numBatches

    // Initialize a batch if not initialized
    if (batches.length >= batchIndex) {
      batches[i] = []
    }

    batches[i].push(drop)
  }

  // Airdrop each batch
  const completedOps: Array<CompletedAirDrop> = []
  for (let i = 0; i < batches.length; i++) {
    try {
      // TODO(keefertaylor): try / catch.

      console.log(`>> Processing batch ${i + 1} of ${batches.length}`)

      const batch = batches[i]
      const tx = tezos.contract.batch()
      for (let j = 0; j < batches.length; j++) {
        const drop = batch[j]

        // TODO(keefertaylor): Presumably this mutates the contract call. TBD.
        tx.withContractCall(
          tokenContract.methods.transfer(
            await signer.publicKeyHash(),
            drop.address,
            drop.amount,
          ),
        )
      }

      // Send and await confirmations
      const txResult = await tx.send()
      console.log(
        `>> Send in hash ${txResult.hash}. Waiting for ${CONFIRMATIONS} confirmation(s).`,
      )
      await txResult.confirmation(CONFIRMATIONS)
      console.log('>> Confirmed!')

      // Record results of airdrop
      for (let j = 0; j < batches.length; j++) {
        const drop = batch[j]
        completedOps.push({
          address: drop.address,
          amount: drop.amount,
          operationHash: txResult.hash,
        })
      }
    } catch (e) {
      console.log(``)
      console.log(`-----------------------------------------------`)
      console.log(`Unexpected error: ${e}`)
      console.log(`Error occured in batch ${i}`)
      console.log(`Batch ${i} dump:`)
      console.log(JSON.stringify(batches[i]))
      console.log(`Please verify that the batch succeeded.`)
      console.log(`-----------------------------------------------`)
      console.log(``)
    }
  }

  // Print results to file
  console.log('> Writing results.')
  const dropFile = 'completed_airdrops.csv'
  if (fs.existsSync(dropFile)) {
    fs.unlinkSync(dropFile)
  }
  fs.writeFileSync(dropFile, `address, amount (mutez), operation hash,\n`)
  for (let i = 0; i < completedOps.length; i++) {
    const completedOp = completedOps[i]

    fs.appendFileSync(
      dropFile,
      `${completedOp.address}, ${completedOp.amount}, ${completedOp.operationHash},\n`,
    )
  }
  console.log(`> Written to ${dropFile}`)
  console.log('')
}

void main()

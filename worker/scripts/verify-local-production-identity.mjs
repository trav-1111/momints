import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

const EXPECTED_SIGNER = '6cpYU6dXcioCqVdBhF93qCruSThroGPrqPVA3h57pV1V'
const TREASURY = 'o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW'
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseVars(source) {
  const values = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const split = line.indexOf('=')
    if (split < 1) continue
    const key = line.slice(0, split).trim()
    let value = line.slice(split + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.ok, true, `RPC ${method} returned HTTP ${response.status}`)
  const body = await response.json()
  assert.equal(body.error, undefined, `RPC ${method} failed: ${body.error?.message ?? 'unknown error'}`)
  return body.result
}

const vars = parseVars(await readFile(join(workerRoot, '.dev.vars'), 'utf8'))
assert.ok(vars.IRYS_FUNDING_KEY, 'IRYS_FUNDING_KEY is missing from worker/.dev.vars')
assert.ok(vars.SOLANA_RPC_URL, 'SOLANA_RPC_URL is missing from worker/.dev.vars')

const secret = bs58.decode(vars.IRYS_FUNDING_KEY)
const keypair = secret.length === 64 ? Keypair.fromSecretKey(secret) : Keypair.fromSeed(secret)
const signer = keypair.publicKey.toBase58()
assert.equal(signer, EXPECTED_SIGNER, 'Local production key does not derive to the expected signer')

const [genesisHash, signerBalance, treasuryBalance, turboResponse] = await Promise.all([
  rpc(vars.SOLANA_RPC_URL, 'getGenesisHash'),
  rpc(vars.SOLANA_RPC_URL, 'getBalance', [signer]),
  rpc(vars.SOLANA_RPC_URL, 'getBalance', [TREASURY]),
  fetch(`https://payment.ardrive.io/v1/account/balance/solana?address=${signer}`, {
    signal: AbortSignal.timeout(15_000),
  }),
])

assert.equal(genesisHash, MAINNET_GENESIS, 'Configured local production RPC is not Solana mainnet')
assert.equal(turboResponse.ok, true, `Turbo balance returned HTTP ${turboResponse.status}`)
const turbo = await turboResponse.json()
const turboAtomic = String(turbo.effectiveBalance ?? turbo.winc ?? '0')

console.log(
  JSON.stringify(
    {
      signer,
      genesisHash,
      signerSolLamports: signerBalance.value,
      treasury: TREASURY,
      treasurySolLamports: treasuryBalance.value,
      turboBalanceAtomic: turboAtomic,
    },
    null,
    2,
  ),
)

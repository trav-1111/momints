import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

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

const vars = parseVars(await readFile(join(workerRoot, '.dev.vars'), 'utf8'))
if (!vars.IRYS_FUNDING_KEY) throw new Error('IRYS_FUNDING_KEY is missing from worker/.dev.vars')

const secret = bs58.decode(vars.IRYS_FUNDING_KEY)
const keypair = secret.length === 64 ? Keypair.fromSecretKey(secret) : Keypair.fromSeed(secret)
const address = keypair.publicKey.toBase58()

if (process.argv.includes('--json')) console.log(JSON.stringify({ address }))
else console.log(`Production signer public address: ${address}`)

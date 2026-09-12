// Opt-in read-only integration check for the deployed Worker identity route.
// node --env-file=.env tests/wallet-domain.live.cjs <public-wallet> <expected-name-or-dash>
const assert = require('node:assert/strict')

async function main() {
  const base = (process.env.EXPO_PUBLIC_ROLL_API || '').replace(/\/+$/, '')
  const wallet = process.argv[2]
  const expected = process.argv[3]
  assert(base && wallet && expected, 'Worker URL, wallet, and expected name are required')
  assert(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet), 'wallet must be a base58 Solana address')
  const started = Date.now()
  const response = await fetch(`${base}/identity/skr?wallet=${encodeURIComponent(wallet)}`)
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(body.domain, expected === '-' ? null : expected)
  console.log(
    JSON.stringify({
      status: body.domain ? 'resolved' : 'not-found',
      label: body.domain ?? `${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
      ms: Date.now() - started,
      workerRequests: 1,
    }),
  )
}
main().catch((error) => {
  console.error(
    'Live Worker identity verification failed: ' +
      (error?.code === 'ERR_ASSERTION' ? 'assertion failed' : 'Worker or configuration error'),
  )
  process.exitCode = 1
})

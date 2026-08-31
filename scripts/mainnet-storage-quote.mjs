#!/usr/bin/env node
// Read-only MAINNET storage price quote. Signs nothing, spends nothing, needs
// no key: every call is a public price/quote endpoint.
//
//   node scripts/mainnet-storage-quote.mjs
//
// Why this exists: fees were priced against a DEVNET Irys quote, and devnet
// Irys pricing is not the mainnet price (it is ~10x higher — see MAINNET_COSTS.md).
// This prints what an upload will ACTUALLY cost the operator on mainnet.
//
// It quotes all three nodes deliberately, because they are not the same product:
//
//   uploader.irys.xyz  what @irys/upload resolves to for mainnet — i.e. what
//                      THIS codebase would pay. Stores to the Irys L1 datachain.
//   node1.irys.xyz     the legacy Irys ARWEAVE bundler. Accepts AR as payment;
//                      data lands on Arweave. This is the price of the Arweave
//                      permanence guarantee the README claims.
//   devnet.irys.xyz    what the Worker uses today. Reference only — devnet
//                      prices are not mainnet prices.

const SIZES = [
  ['metadata JSON (4 KiB)', 4 * 1024],
  ['cover ceiling (200 KiB)', 200 * 1024],
  ['typical frame (1.5 MB)', 1_500_000],
  ['frame CEILING (3 MiB)', 3 * 1024 * 1024],
  ['1 GiB (for $/GB)', 1024 ** 3],
]

const NODES = [
  ['uploader.irys.xyz', 'https://uploader.irys.xyz', 'SDK mainnet — Irys L1 datachain'],
  ['node1.irys.xyz', 'https://node1.irys.xyz', 'legacy bundler — settles to Arweave'],
  ['devnet.irys.xyz', 'https://devnet.irys.xyz', 'SDK devnet — reference only'],
]

const LAMPORTS_PER_SOL = 1e9
const timeout = (ms) => AbortSignal.timeout(ms)

async function text(url) {
  const r = await fetch(url, { signal: timeout(20000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.text()).trim()
}

async function solUsd() {
  const SOL = 'So11111111111111111111111111111111111111112'
  try {
    const j = await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL}`, { signal: timeout(20000) })).json()
    const p = j[SOL]?.usdPrice
    if (p) return { price: Number(p), source: 'Jupiter' }
  } catch {}
  const j = await (
    await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: timeout(20000) })
  ).json()
  return { price: Number(j.solana.usd), source: 'CoinGecko' }
}

async function arUsd() {
  try {
    const j = await (
      await fetch('https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd', { signal: timeout(20000) })
    ).json()
    return Number(j.arweave.usd)
  } catch {
    return null
  }
}

const usd = (lamports, sol) => (lamports / LAMPORTS_PER_SOL) * sol

const { price: SOL_USD, source } = await solUsd()
const AR_USD = await arUsd()

console.log(`Momints — MAINNET storage price quote (read-only; nothing signed, nothing spent)`)
console.log(`generated ${new Date().toISOString()}`)
console.log(`SOL/USD ${SOL_USD.toFixed(2)} (${source})${AR_USD ? `   AR/USD ${AR_USD.toFixed(2)} (CoinGecko)` : ''}\n`)

for (const [name, base, note] of NODES) {
  console.log(`${name}  — ${note}`)
  for (const [label, bytes] of SIZES) {
    try {
      const lamports = Number(await text(`${base}/price/solana/${bytes}`))
      const sol = lamports / LAMPORTS_PER_SOL
      console.log(
        `  ${label.padEnd(24)} ${String(lamports).padStart(12)} atomic = ${sol.toFixed(9)} SOL = ~$${usd(lamports, SOL_USD).toFixed(4)}`,
      )
    } catch (e) {
      console.log(`  ${label.padEnd(24)} ERROR ${e.message}`)
    }
  }
  console.log()
}

// Arweave's own oracle, as an independent floor on what permanent Arweave
// bytes can possibly cost — a bundler quoting far below this is not selling
// Arweave storage.
if (AR_USD) {
  console.log('Arweave native price oracle (arweave.net/price) — independent cost floor')
  for (const [label, bytes] of SIZES) {
    try {
      const winston = Number(await text(`https://arweave.net/price/${bytes}`))
      const ar = winston / 1e12
      console.log(`  ${label.padEnd(24)} ${ar.toFixed(9)} AR = ~$${(ar * AR_USD).toFixed(4)}`)
    } catch (e) {
      console.log(`  ${label.padEnd(24)} ERROR ${e.message}`)
    }
  }
}

console.log(`
NOTE: uploader.irys.xyz and node1.irys.xyz are different products, not
competing prices for the same thing. Data uploaded through the modern stack
(uploader.irys.xyz -> gateway.irys.xyz) is served from the Irys L1 datachain
and is NOT retrievable on arweave.net. Verify which one the product's
permanence claim needs before treating the cheaper number as "our cost".`)

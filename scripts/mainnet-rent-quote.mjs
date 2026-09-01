#!/usr/bin/env node
// Read-only MAINNET rent + transaction-fee quote for the Metaplex Core accounts
// Momints creates. Signs nothing, spends nothing, needs no key — it reads the
// live rent sysvar and computes account sizes from the Core layout.
//
//   node scripts/mainnet-rent-quote.mjs
//
// This is Task 2(a): the clean way to get real Core mint rent without minting.
// No mainnet transaction is required or performed.
//
// SIZE MODEL — validated, not guessed:
//   * the AssetV1 header model reproduced the byte length of 5/5 real mainnet
//     Core assets sampled from recent Core-program transactions;
//   * plugin data sizes come from mpl-core's own serializer (VerifiedCreators
//     38 B, Royalties 41 B, UpdateDelegate 5 B);
//   * the resulting roll-collection figure (2,610,000 lamports) reproduces the
//     value the repo independently measured from a real minted collection.

const RPC = process.env.SOLANA_RPC_URL_MAINNET ?? 'https://api.mainnet-beta.solana.com'
const ACCOUNT_STORAGE_OVERHEAD = 128
const LAMPORTS_PER_SOL = 1e9
const BASE_FEE_PER_SIGNATURE = 5000

// SIMD-0437 steps out of the pre-reduction 6960 baseline.
const SIMD_0437_STEPS = [6333, 5080, 2575, 1322, 696]

async function rpc(method, params = []) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25000),
  })
  const j = await r.json()
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result
}

// ---- Core account size model -------------------------------------------------
const PLUGIN_DATA = { VerifiedCreators: 38, Royalties: 41, UpdateDelegate: 5 }
const authoritySize = (kind) => (kind === 'Address' ? 1 + 32 : 1)

/** Plugin header + each plugin's data + the registry that indexes them. */
function pluginAreaSize(plugins) {
  if (plugins.length === 0) return 0
  const header = 1 + 8
  const data = plugins.reduce((n, p) => n + PLUGIN_DATA[p.type], 0)
  const records = plugins.reduce((n, p) => n + 1 + authoritySize(p.authority) + 8, 0)
  const registry = 1 + 4 + records + 4
  return header + data + registry
}

const assetSize = ({ nameLen, uriLen, updateAuthority, plugins }) =>
  1 + 32 + (updateAuthority === 'None' ? 1 : 33) + 4 + nameLen + 4 + uriLen + 1 + pluginAreaSize(plugins)

const collectionSize = ({ nameLen, uriLen, plugins }) =>
  1 + 32 + 4 + nameLen + 4 + uriLen + 4 + 4 + pluginAreaSize(plugins)

// ---- The three shapes Momints actually creates -------------------------------
// URI is `https://gateway.irys.xyz/<44>` = 69 chars (43-char ids give 68, i.e.
// one byte / 6960 lamports less — the 69 case is quoted as the conservative one).
const IRYS_URI_LEN = 69

const SHAPES = [
  {
    label: 'roll frame asset (AssetV1)',
    payer: 'OPERATOR (Worker mints it)',
    size: assetSize({
      nameLen: 17, // yyyy-mm-dd.NN.001
      uriLen: IRYS_URI_LEN,
      updateAuthority: 'Collection',
      plugins: [{ type: 'VerifiedCreators', authority: 'UpdateAuthority' }],
    }),
  },
  {
    label: 'roll collection (CollectionV1)',
    payer: 'OPERATOR (once per roll)',
    size: collectionSize({
      nameLen: 13, // yyyy-mm-dd.NN
      uriLen: IRYS_URI_LEN,
      plugins: [
        { type: 'UpdateDelegate', authority: 'Address' },
        { type: 'Royalties', authority: 'UpdateAuthority' },
      ],
    }),
  },
  {
    label: 'quick-mint asset, 20-char name',
    payer: 'USER (their wallet mints it)',
    size: assetSize({
      nameLen: 20,
      uriLen: IRYS_URI_LEN,
      updateAuthority: 'Address',
      plugins: [
        { type: 'Royalties', authority: 'UpdateAuthority' },
        { type: 'VerifiedCreators', authority: 'UpdateAuthority' },
      ],
    }),
  },
  {
    label: 'quick-mint asset, 64-char max',
    payer: 'USER (their wallet mints it)',
    size: assetSize({
      nameLen: 64,
      uriLen: IRYS_URI_LEN,
      updateAuthority: 'Address',
      plugins: [
        { type: 'Royalties', authority: 'UpdateAuthority' },
        { type: 'VerifiedCreators', authority: 'UpdateAuthority' },
      ],
    }),
  },
]

// ---- Live chain state --------------------------------------------------------
const rentAcct = await rpc('getAccountInfo', ['SysvarRent111111111111111111111111111111111', { encoding: 'base64' }])
const rentBuf = Buffer.from(rentAcct.value.data[0], 'base64')
const lamportsPerByteYear = Number(rentBuf.readBigUInt64LE(0))
const exemptionThreshold = rentBuf.readDoubleLE(8)
const LPB = lamportsPerByteYear * exemptionThreshold

const solUsdJson = await (
  await fetch('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112', {
    signal: AbortSignal.timeout(20000),
  })
).json()
const SOL_USD = Number(solUsdJson['So11111111111111111111111111111111111111112'].usdPrice)

const stepIndex = SIMD_0437_STEPS.indexOf(LPB)
const stepLabel =
  LPB === 6960
    ? 'step 0 of 5 — NO reduction active yet (pre-SIMD-0437 baseline)'
    : stepIndex >= 0
      ? `step ${stepIndex + 1} of 5 active`
      : 'UNRECOGNISED value — check SIMD-0437 for a schedule change'

console.log(`Momints — MAINNET Core rent + tx fee quote (read-only; nothing signed, nothing spent)`)
console.log(`generated ${new Date().toISOString()}   RPC ${new URL(RPC).host}`)
console.log(`SOL/USD ${SOL_USD.toFixed(2)} (Jupiter)\n`)
console.log(`rent sysvar: lamports_per_byte_year=${lamportsPerByteYear} exemption_threshold=${exemptionThreshold}`)
console.log(`effective lamports_per_byte = ${LPB}   -> SIMD-0437 ${stepLabel}\n`)

const usd = (l) => (l / LAMPORTS_PER_SOL) * SOL_USD
const rentFor = (size, lpb = LPB) => (ACCOUNT_STORAGE_OVERHEAD + size) * lpb

console.log('account rent today')
for (const s of SHAPES) {
  const rent = rentFor(s.size)
  // Cross-check the model against the cluster's own answer for that size.
  const chain = await rpc('getMinimumBalanceForRentExemption', [s.size])
  console.log(
    `  ${s.label.padEnd(31)} ${String(s.size).padStart(4)} B  ${String(rent).padStart(9)} lamports = ` +
      `${(rent / LAMPORTS_PER_SOL).toFixed(9)} SOL = ~$${usd(rent).toFixed(4)}  ` +
      `[chain says ${chain} ${chain === rent ? 'OK' : 'MISMATCH'}]  payer: ${s.payer}`,
  )
}

console.log('\nprojection as the remaining SIMD-0437 steps activate (same accounts)')
process.stdout.write(`  ${'shape'.padEnd(31)}`)
for (const lpb of [6960, ...SIMD_0437_STEPS]) process.stdout.write(String(lpb).padStart(11))
console.log()
for (const s of SHAPES) {
  process.stdout.write(`  ${s.label.padEnd(31)}`)
  for (const lpb of [6960, ...SIMD_0437_STEPS]) {
    process.stdout.write(`$${usd(rentFor(s.size, lpb)).toFixed(4)}`.padStart(11))
  }
  console.log()
}

console.log('\ntransaction fees')
console.log(
  `  base fee per signature      ${BASE_FEE_PER_SIGNATURE} lamports = ` +
    `${(BASE_FEE_PER_SIGNATURE / LAMPORTS_PER_SOL).toFixed(9)} SOL = ~$${usd(BASE_FEE_PER_SIGNATURE).toFixed(6)}`,
)
const prio = await rpc('getRecentPrioritizationFees', [[]])
const nonZero = prio.map((p) => p.prioritizationFee).filter((f) => f > 0)
nonZero.sort((a, b) => a - b)
console.log(
  `  recent priority fees        ${nonZero.length ? `median ${nonZero[Math.floor(nonZero.length / 2)]} micro-lamports/CU over ${prio.length} slots` : 'all zero in the sampled slots'}`,
)
console.log(
  `  quick-mint URI swap         1 extra signature, operator-paid = ~$${usd(BASE_FEE_PER_SIGNATURE).toFixed(6)}`,
)

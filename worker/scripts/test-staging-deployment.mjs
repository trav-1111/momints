import assert from 'node:assert/strict'
import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Keypair } from '@solana/web3.js'

if (!process.argv.includes('--confirm-new-sandbox')) {
  throw new Error(
    'Disabled after promotion: the former staging Worker now targets production. ' +
      'Provision a new isolated sandbox before running synthetic seed/cleanup tests.',
  )
}

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(workerRoot, 'wrangler.staging.toml')
const wranglerPath = join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const credentialsPath = join(workerRoot, '.staging-secrets', 'credentials.json')
const evidenceRoot = join(workerRoot, '.staging-evidence', new Date().toISOString().replaceAll(':', '-'))
const baseUrl = 'https://staging-api.momints.xyz'
const connectIpIndex = process.argv.indexOf('--connect-ip')
const connectIp = connectIpIndex === -1 ? undefined : process.argv[connectIpIndex + 1]

if (!process.argv.includes('--confirm-staging')) throw new Error('Pass --confirm-staging to run remote synthetic tests')
if (connectIp && isIP(connectIp) === 0) throw new Error('--connect-ip must be a valid IP address')

const [config, credentials, immutableLock] = await Promise.all([
  readFile(configPath, 'utf8'),
  readFile(credentialsPath, 'utf8').then(JSON.parse),
  readFile(join(workerRoot, 'filmstock-assets', 'immutable-lock.json'), 'utf8').then(JSON.parse),
])
if (!config.includes('name = "momints-roll-worker-staging"') || !config.includes('staging-api.momints.xyz')) {
  throw new Error('Refusing remote tests: staging configuration guard failed')
}

await mkdir(evidenceRoot, { recursive: true })
const results = []
const startedAt = new Date().toISOString()
const qa = {
  v2Collection: Keypair.generate().publicKey.toBase58(),
  v2Wallet: Keypair.generate().publicKey.toBase58(),
  legacyCollection: Keypair.generate().publicKey.toBase58(),
  legacyWallet: Keypair.generate(),
  missingCollection: Keypair.generate().publicKey.toBase58(),
  v2Capability: randomBytes(32).toString('base64url'),
  legacyCapability: randomBytes(32).toString('base64url'),
  wrongCapability: randomBytes(32).toString('base64url'),
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function sql(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function runWrangler(args, { expectSuccess = true } = {}) {
  const result = spawnSync(process.execPath, [wranglerPath, '--config', configPath, ...args], {
    cwd: workerRoot,
    encoding: 'utf8',
    shell: false,
  })
  if (expectSuccess && result.status !== 0) {
    throw new Error(`Wrangler command failed (${args.slice(0, 4).join(' ')}): ${String(result.stderr)}`)
  }
  return result
}

function d1(command) {
  const result = runWrangler([
    'd1',
    'execute',
    'momints-rolls-staging',
    '--remote',
    '--command',
    command,
    '--json',
    '--yes',
  ])
  return JSON.parse(result.stdout)
}

function d1Row(query) {
  return d1(query)[0]?.results?.[0]
}

function jpeg(width, height, byteLength = 64) {
  const header = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
    0xff,
    0xda,
    0x00,
    0x08,
    0x01,
    0x01,
    0x00,
    0x00,
    0x3f,
    0x00,
  ])
  if (byteLength < header.length + 3) throw new Error('JPEG fixture is too small')
  const bytes = Buffer.alloc(byteLength)
  Buffer.from(header).copy(bytes)
  bytes[header.length] = 0
  bytes[byteLength - 2] = 0xff
  bytes[byteLength - 1] = 0xd9
  return bytes
}

function multipart(fields, imageBytes, filename = 'synthetic.jpg', contentType = 'image/jpeg') {
  const boundary = `momints-staging-${randomBytes(12).toString('hex')}`
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(imageBytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  )
  const body = Buffer.concat(parts)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(path, baseUrl)
  return new Promise((resolveRequest, reject) => {
    const request = httpsRequest(
      url,
      {
        method,
        headers: { ...headers, ...(body ? { 'content-length': String(body.length) } : {}) },
        ...(connectIp
          ? {
              lookup(_hostname, options, callback) {
                const family = isIP(connectIp)
                if (options?.all) callback(null, [{ address: connectIp, family }])
                else callback(null, connectIp, family)
              },
            }
          : {}),
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const bytes = Buffer.concat(chunks)
          const text = bytes.toString('utf8')
          let json
          try {
            json = JSON.parse(text)
          } catch {
            json = null
          }
          resolveRequest({ status: response.statusCode, headers: response.headers, bytes, text, json })
        })
      },
    )
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function record(name, expected, response, predicate = () => true, detail = {}) {
  const passed = response.status === expected && predicate(response)
  results.push({ name, expectedStatus: expected, actualStatus: response.status, passed, ...detail })
  assert.ok(passed, `${name}: expected HTTP ${expected}, got ${response.status}: ${response.text.slice(0, 500)}`)
  return response
}

async function jsonRequest(path, body, options = {}) {
  const bytes = Buffer.from(JSON.stringify(body))
  return request(path, {
    method: options.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: bytes,
  })
}

async function upload(path, fields, imageBytes, options = {}) {
  const form = multipart(fields, imageBytes, options.filename, options.contentType)
  return request(path, {
    method: 'POST',
    headers: { 'content-type': form.contentType, ...(options.headers ?? {}) },
    body: form.body,
  })
}

const opsHeaders = { authorization: `Bearer ${credentials.opsAuthToken}` }
const v2Bytes = jpeg(4000, 3000, 3 * 1024 * 1024)
const legacyBytes = jpeg(4000, 3000, 8 * 1024 * 1024)
const v2Hash = sha256(v2Bytes)
const v2CapabilityHash = sha256(Buffer.from(qa.v2Capability))
const legacyCapabilityHash = sha256(Buffer.from(qa.legacyCapability))
let stagedObjectKey = null
let initialState
let finalState

function state() {
  return d1Row(
    'SELECT (SELECT COUNT(*) FROM rolls) AS rolls, (SELECT COUNT(*) FROM frames) AS frames, ' +
      '(SELECT COUNT(*) FROM quick_mints) AS quick_mints, (SELECT COUNT(*) FROM frame_locks) AS frame_locks, ' +
      '(SELECT COUNT(*) FROM treasury_entries) AS treasury_entries',
  )
}

try {
  initialState = state()
  const health = record('public health and D1 reachability', 200, await request('/health'), (r) => r.json?.ok === true)
  assert.equal(health.json.checks.deployment, 'staging')
  assert.equal(health.json.checks.discordWebhookConfigured, false)
  record('public fee schedule', 200, await request('/fees'), (r) => Number.isInteger(r.json?.quickFeeLamports))

  const catalogue = record(
    'filmstock catalogue uses staging origin',
    200,
    await request('/v1/filmstocks'),
    (r) =>
      r.json?.filmstocks?.length === 4 &&
      r.json.filmstocks.every((stock) => stock.recipeUrl.startsWith(baseUrl)) &&
      r.headers['cache-control']?.includes('s-maxage=300'),
  )
  for (const stock of catalogue.json.filmstocks) {
    const recipe = record(`recipe ${stock.filmStockId}`, 200, await request(new URL(stock.recipeUrl).pathname), (r) =>
      r.headers['cache-control']?.includes('immutable'),
    )
    if (recipe.json?.schemaVersion === 2) {
      const lutPath = new URL(recipe.json.lut.uri, stock.recipeUrl).pathname
      record(
        `LUT hash ${stock.filmStockId}`,
        200,
        await request(lutPath),
        (r) => sha256(r.bytes) === recipe.json.lut.sha256 && r.headers['cache-control']?.includes('immutable'),
      )
    }
    const cachedRecipe = await request(new URL(stock.recipeUrl).pathname)
    assert.equal(cachedRecipe.status, 200)
    assert.equal(cachedRecipe.headers.etag, recipe.headers.etag)
    assert.equal(sha256(cachedRecipe.bytes), sha256(recipe.bytes))
    const immutableCacheHeaders = Boolean(
      recipe.headers.etag && recipe.headers['cache-control']?.includes('max-age=31536000'),
    )
    assert.ok(immutableCacheHeaders)
    results.push({
      name: `immutable cache headers ${stock.filmStockId}`,
      passed: immutableCacheHeaders,
      etagStable: true,
    })
    for (const previewUrl of stock.previewImageUrls) {
      record(
        `preview ${new URL(previewUrl).pathname}`,
        200,
        await request(new URL(previewUrl).pathname),
        (r) => immutableLock[new URL(previewUrl).pathname.replace('/v1/filmstocks/assets/', '')] === sha256(r.bytes),
      )
    }
  }

  for (const route of ['/funding/status', '/treasury/status', '/ops/status']) {
    record(`${route} rejects missing operator token`, 401, await request(route))
    record(
      `${route} rejects wrong operator token`,
      401,
      await request(route, { headers: { authorization: 'Bearer wrong' } }),
    )
    record(`${route} accepts valid operator token`, 200, await request(route, { headers: opsHeaders }))
  }
  const allowedOrigin = 'https://staging-dashboard.momints.xyz'
  record(
    'dashboard CORS preflight allows only configured origin',
    204,
    await request('/ops/dashboard/health', { method: 'OPTIONS', headers: { origin: allowedOrigin } }),
    (r) => r.headers['access-control-allow-origin'] === allowedOrigin,
  )
  record(
    'dashboard CORS does not reflect arbitrary origin',
    204,
    await request('/ops/dashboard/health', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
    (r) => !r.headers['access-control-allow-origin'],
  )
  record(
    'dashboard error remains readable to configured origin',
    401,
    await request('/ops/dashboard/health', { headers: { origin: allowedOrigin } }),
    (r) => r.headers['access-control-allow-origin'] === allowedOrigin,
  )
  record(
    'dashboard health read with valid token',
    200,
    await request('/ops/dashboard/health', { headers: { ...opsHeaders, origin: allowedOrigin } }),
  )
  record('safe empty quick sweep', 200, await request('/ops/sweep-quick-mints', { headers: opsHeaders }))
  record('manual fee recompute route', 200, await request('/ops/recompute-fees', { headers: opsHeaders }))

  record(
    'invalid filmstock unlock address',
    400,
    await jsonRequest('/v1/filmstocks/unlocked', { creatorAddress: 'bad' }),
  )
  record(
    'valid filmstock unlock read',
    200,
    await jsonRequest('/v1/filmstocks/unlocked', { creatorAddress: qa.v2Wallet }),
    (r) => Array.isArray(r.json?.unlockedFilmStockIds),
  )

  d1(`
    INSERT INTO rolls (collection_address,wallet,name,size,artist,skr_identity,cover_uri,metadata_uri,minted_count,status,create_signature,fee_signature,protocol_version,auth_hash)
    VALUES (${sql(qa.v2Collection)},${sql(qa.v2Wallet)},'2099-01-01.01',12,'QA v2','qa-v2','https://arweave.net/qa-cover','https://arweave.net/qa-metadata',1,'OPEN','qa-create-v2','qa-fee-v2',2,${sql(v2CapabilityHash)});
    INSERT INTO frames (collection_address,frame_index,status,image_uri,metadata_uri,asset_address,mint_signature,mime,byte_length,width,height,image_hash)
    VALUES (${sql(qa.v2Collection)},1,'MINTED','https://arweave.net/qa-image','https://arweave.net/qa-frame-metadata',${sql(Keypair.generate().publicKey.toBase58())},'qa-mint-v2','image/jpeg',${v2Bytes.length},4000,3000,${sql(v2Hash)});
    INSERT INTO rolls (collection_address,wallet,name,size,artist,skr_identity,cover_uri,metadata_uri,minted_count,status,create_signature,fee_signature,protocol_version,auth_hash)
    VALUES (${sql(qa.legacyCollection)},${sql(qa.legacyWallet.publicKey.toBase58())},'2099-01-01.02',12,'QA legacy','qa-legacy','https://arweave.net/qa-cover','https://arweave.net/qa-metadata',1,'OPEN','qa-create-legacy',NULL,1,NULL);
    INSERT INTO frames (collection_address,frame_index,status,image_uri,metadata_uri,asset_address,mint_signature)
    VALUES (${sql(qa.legacyCollection)},1,'MINTED','https://arweave.net/qa-image','https://arweave.net/qa-frame-metadata',${sql(Keypair.generate().publicKey.toBase58())},'qa-mint-legacy');
  `)

  record(
    'open-roll read finds synthetic roll',
    200,
    await request(`/rolls/open?wallet=${qa.v2Wallet}`),
    (r) => r.json?.openRoll?.collectionAddress === qa.v2Collection,
  )
  record('roll read rejects missing capability', 401, await request(`/rolls/${qa.v2Collection}`))
  record(
    'roll read rejects malformed capability',
    401,
    await request(`/rolls/${qa.v2Collection}`, { headers: { authorization: 'Roll bad' } }),
  )
  record(
    'roll read rejects wrong capability',
    403,
    await request(`/rolls/${qa.v2Collection}`, { headers: { authorization: `Roll ${qa.wrongCapability}` } }),
  )
  record(
    'roll read accepts matching capability',
    200,
    await request(`/rolls/${qa.v2Collection}`, { headers: { authorization: `Roll ${qa.v2Capability}` } }),
  )
  record(
    'wrong roll remains absent',
    404,
    await request(`/rolls/${qa.missingCollection}`, { headers: { authorization: `Roll ${qa.v2Capability}` } }),
  )

  const v2Fields = { frameIndex: '1' }
  record(
    'frame mutation rejects missing capability before body work',
    401,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, Buffer.from('not-an-image')),
  )
  record(
    'new-roll exact 3 MiB JPEG ceiling',
    200,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, v2Bytes, {
      headers: { authorization: `Roll ${qa.v2Capability}` },
    }),
  )
  record(
    'new-roll byte above 3 MiB rejected',
    413,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, jpeg(4000, 3000, 3 * 1024 * 1024 + 1), {
      headers: { authorization: `Roll ${qa.v2Capability}` },
    }),
  )
  record(
    'truncated JPEG rejected',
    400,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, v2Bytes.subarray(0, v2Bytes.length - 1), {
      headers: { authorization: `Roll ${qa.v2Capability}` },
    }),
  )
  record(
    'MIME-spoofed non-JPEG rejected',
    400,
    await upload(
      `/rolls/${qa.v2Collection}/frames`,
      v2Fields,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      { headers: { authorization: `Roll ${qa.v2Capability}` }, filename: 'spoof.jpg' },
    ),
  )
  record(
    'excessive long edge rejected',
    413,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, jpeg(4001, 2999), {
      headers: { authorization: `Roll ${qa.v2Capability}` },
    }),
  )
  record(
    'excessive pixel count rejected',
    413,
    await upload(`/rolls/${qa.v2Collection}/frames`, v2Fields, jpeg(4000, 3001), {
      headers: { authorization: `Roll ${qa.v2Capability}` },
    }),
  )
  record(
    'completion rejects wrong roll capability',
    403,
    await request(`/rolls/${qa.v2Collection}/complete`, {
      method: 'POST',
      headers: { authorization: `Roll ${qa.wrongCapability}` },
    }),
  )

  record(
    'legacy roll requires recovery',
    428,
    await request(`/rolls/${qa.legacyCollection}`, { headers: { authorization: `Roll ${qa.legacyCapability}` } }),
  )
  record(
    'legacy recovery rejects wrong wallet',
    403,
    await jsonRequest(`/rolls/${qa.legacyCollection}/authorize`, {
      wallet: qa.v2Wallet,
      rollCapability: qa.legacyCapability,
      issuedAt: new Date().toISOString(),
      signature: Buffer.alloc(64).toString('base64'),
    }),
  )
  record(
    'legacy recovery rejects expired claim',
    400,
    await jsonRequest(`/rolls/${qa.legacyCollection}/authorize`, {
      wallet: qa.legacyWallet.publicKey.toBase58(),
      rollCapability: qa.legacyCapability,
      issuedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      signature: Buffer.alloc(64).toString('base64'),
    }),
  )
  const issuedAt = new Date().toISOString()
  const claimMessage = [
    'Momints roll authorization v1',
    `Collection: ${qa.legacyCollection}`,
    `Wallet: ${qa.legacyWallet.publicKey.toBase58()}`,
    `Capability SHA-256: ${legacyCapabilityHash}`,
    `Issued at: ${issuedAt}`,
  ].join('\n')
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(qa.legacyWallet.secretKey.subarray(0, 32)),
  ])
  const signature = sign(
    null,
    Buffer.from(claimMessage),
    createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }),
  ).toString('base64')
  record(
    'valid wallet-signed legacy recovery',
    200,
    await jsonRequest(`/rolls/${qa.legacyCollection}/authorize`, {
      wallet: qa.legacyWallet.publicKey.toBase58(),
      rollCapability: qa.legacyCapability,
      issuedAt,
      signature,
    }),
  )
  record(
    'recovered legacy roll read',
    200,
    await request(`/rolls/${qa.legacyCollection}`, { headers: { authorization: `Roll ${qa.legacyCapability}` } }),
  )
  record(
    'legacy exact 8 MiB allowance',
    200,
    await upload(`/rolls/${qa.legacyCollection}/frames`, { frameIndex: '1' }, legacyBytes, {
      headers: { authorization: `Roll ${qa.legacyCapability}` },
    }),
  )
  record(
    'legacy byte above 8 MiB rejected',
    413,
    await upload(`/rolls/${qa.legacyCollection}/frames`, { frameIndex: '1' }, jpeg(4000, 3000, 8 * 1024 * 1024 + 1), {
      headers: { authorization: `Roll ${qa.legacyCapability}` },
    }),
  )

  const quickMetadata = JSON.stringify({ name: 'Synthetic staging receipt', description: 'No user photograph' })
  record(
    'quick stage rejects malformed JPEG',
    400,
    await upload('/quick/stage', { wallet: qa.v2Wallet, metadata: quickMetadata }, Buffer.from('bad')),
  )
  record(
    'quick stage rejects oversized JPEG',
    413,
    await upload(
      '/quick/stage',
      { wallet: qa.v2Wallet, metadata: quickMetadata },
      jpeg(4000, 3000, 3 * 1024 * 1024 + 1),
    ),
  )
  const targetBytes = jpeg(4000, 3000, 2_900_000)
  const staged = record(
    'valid quick stage stores Worker-derived receipt',
    201,
    await upload('/quick/stage', { wallet: qa.v2Wallet, metadata: quickMetadata }, targetBytes),
    (r) => r.json?.byteLength === targetBytes.length && r.json?.imageHash === sha256(targetBytes),
  )
  const stagingKey = staged.json.stagingKey
  stagedObjectKey = `quick-staging/${qa.v2Wallet}/${stagingKey}`
  const transferredObject = join(evidenceRoot, 'r2-object.bin')
  runWrangler([
    'r2',
    'object',
    'get',
    `momints-quick-staging-test/${stagedObjectKey}`,
    '--remote',
    '--file',
    transferredObject,
  ])
  assert.equal(sha256(await readFile(transferredObject)), sha256(targetBytes))
  results.push({ name: 'staged R2 object matches submitted bytes', passed: true })
  await rm(transferredObject, { force: true })
  const receipt = d1Row(
    `SELECT byte_length,width,height,image_hash,status FROM quick_mints WHERE id=${sql(stagingKey)}`,
  )
  assert.deepEqual(receipt, {
    byte_length: targetBytes.length,
    width: 4000,
    height: 3000,
    image_hash: sha256(targetBytes),
    status: 'STAGED',
  })
  results.push({ name: 'staged D1 receipt matches bytes', passed: true })
  record(
    'unpaid finalize request rejected before queue',
    400,
    await jsonRequest('/quick/finalize', { stagingKey, signature: 'bad', assetAddress: 'bad' }),
  )
  record('unknown quick asset read', 404, await request(`/quick/${qa.missingCollection}`))
  record(
    'quick stage release removes unpaid fixture',
    200,
    await request(`/quick/stage/${stagingKey}`, { method: 'DELETE' }),
    (r) => r.json?.released === true,
  )
  const missingObject = runWrangler(
    ['r2', 'object', 'get', `momints-quick-staging-test/${stagedObjectKey}`, '--remote', '--file', transferredObject],
    { expectSuccess: false },
  )
  assert.notEqual(missingObject.status, 0)
  results.push({ name: 'released quick R2 object removed', passed: true })
  stagedObjectKey = null
  record(
    'quick stage release is idempotent',
    200,
    await request(`/quick/stage/${stagingKey}`, { method: 'DELETE' }),
    (r) => r.json?.reason === 'not-found',
  )
  assert.equal(d1Row(`SELECT COUNT(*) AS count FROM quick_mints WHERE id=${sql(stagingKey)}`).count, 0)
  results.push({ name: 'released quick D1 row removed', passed: true })

  let rateLimitedAt = null
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const response = await request('/quick/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('x'),
    })
    if (response.status === 429) {
      rateLimitedAt = attempt
      break
    }
    assert.equal(response.status, 400)
  }
  assert.ok(rateLimitedAt, 'staging Quick rate limiter did not return 429')
  results.push({ name: 'Quick staging rate limit returns controlled 429', passed: true, rateLimitedAt })
} catch (error) {
  results.push({ name: 'test run', passed: false, error: error instanceof Error ? error.message : String(error) })
  throw error
} finally {
  if (stagedObjectKey) {
    runWrangler(['r2', 'object', 'delete', `momints-quick-staging-test/${stagedObjectKey}`, '--remote'], {
      expectSuccess: false,
    })
  }
  try {
    d1(`
      DELETE FROM frame_locks WHERE collection_address IN (${sql(qa.v2Collection)},${sql(qa.legacyCollection)});
      DELETE FROM frames WHERE collection_address IN (${sql(qa.v2Collection)},${sql(qa.legacyCollection)});
      DELETE FROM rolls WHERE collection_address IN (${sql(qa.v2Collection)},${sql(qa.legacyCollection)});
      DELETE FROM quick_mints WHERE wallet IN (${sql(qa.v2Wallet)},${sql(qa.legacyWallet.publicKey.toBase58())});
      DELETE FROM skr_quotes WHERE wallet IN (${sql(qa.v2Wallet)},${sql(qa.legacyWallet.publicKey.toBase58())});
    `)
    finalState = state()
  } catch (cleanupError) {
    results.push({
      name: 'synthetic cleanup',
      passed: false,
      error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    })
  }
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl,
    syntheticOnly: true,
    paidOperations: false,
    notificationsInvoked: false,
    initialState,
    finalState,
    stateRestored: initialState && finalState ? JSON.stringify(initialState) === JSON.stringify(finalState) : false,
    results,
  }
  await writeFile(join(evidenceRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await rm(join(evidenceRoot, 'r2-object.bin'), { force: true })
  console.log(`Staging report: ${join(evidenceRoot, 'report.json')}`)
  console.log(
    `Passed ${results.filter((result) => result.passed).length}/${results.length}; state restored: ${report.stateRestored}`,
  )
}

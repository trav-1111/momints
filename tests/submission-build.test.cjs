const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  readAppEnvironment,
  readSigningCredentials,
  signingPolicy,
  redactor,
} = require('../scripts/build-submission-apk.cjs')

const appEnvironment = [
  'EXPO_PUBLIC_ROLL_API=https://api.momints.xyz',
  'EXPO_PUBLIC_ROLL_TREASURY=o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW',
  'EXPO_PUBLIC_SOLANA_RPC=https://mainnet.rpc.invalid/?api-key=test-only-value',
].join('\n')

test('release app configuration selects only the three authorized public fields', () => {
  const result = readAppEnvironment(
    appEnvironment + '\nOPS_AUTH_TOKEN=not-a-real-token\nIRYS_FUNDING_KEY=not-a-real-key',
  )
  assert.deepEqual(
    Object.keys(result).sort(),
    ['EXPO_PUBLIC_ROLL_API', 'EXPO_PUBLIC_ROLL_TREASURY', 'EXPO_PUBLIC_SOLANA_RPC'].sort(),
  )
})

test('release preparation rejects wrong API, treasury, non-mainnet and interpolated RPC configuration', () => {
  for (const input of [
    appEnvironment.replace('https://api.momints.xyz', 'https://staging-api.momints.xyz'),
    appEnvironment.replace('o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW', 'different-treasury'),
    appEnvironment.replace('mainnet.rpc.invalid', 'devnet.rpc.invalid'),
    appEnvironment.replace('https://mainnet.rpc.invalid/?api-key=test-only-value', '${PRIVATE_RPC}'),
  ])
    assert.throws(() => readAppEnvironment(input))
})

test('build log redaction removes app RPC and credential strings', () => {
  const redact = redactor(['https://rpc.invalid/?api-key=fixture', 'fixture-store-password'])
  assert.equal(redact('https://rpc.invalid/?api-key=fixture fixture-store-password'), '[REDACTED] [REDACTED]')
})

test('signing preflight fails closed without credentials or when supplied a debug key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momints-signing-test-'))
  try {
    const file = path.join(dir, 'credentials.json')
    assert.throws(() => readSigningCredentials(file), /credentials JSON is required/)
    fs.writeFileSync(
      file,
      JSON.stringify({
        android: {
          keystore: {
            keystorePath: 'debug.keystore',
            keystorePassword: 'fixture',
            keyAlias: 'androiddebugkey',
            keyPassword: 'fixture',
          },
        },
      }),
    )
    assert.throws(() => readSigningCredentials(file), /debug signing key/)
    fs.writeFileSync(
      file,
      JSON.stringify({
        android: {
          keystore: {
            keystorePath: 'missing-release.jks',
            keystorePassword: 'fixture',
            keyAlias: 'fixture-release',
            keyPassword: 'fixture',
          },
        },
      }),
    )
    assert.throws(() => readSigningCredentials(file), /keystore file is unavailable/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('native signing guard overrides release only, rejects debug certificates and never regenerates identity', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/android-release.init.gradle'), 'utf8')
  assert.match(source, /finalizeDsl/)
  assert.match(source, /release\.signingConfig = releaseSigning/)
  assert.match(source, /release\.debuggable = false/)
  assert.match(source, /cn=android debug/)
  assert.match(source, /MOMINTS_ANDROID_EXPECTED_CERT_SHA256/)
  assert.match(source, /debugIdentity && !hackathonDebugSigning/)
  assert.match(source, /hackathonDebugSigning && !debugIdentity/)
  assert.match(source, /certificateHash != expectedHash/)
  assert.doesNotMatch(source, /genkey|signingConfigs\.debug/)
})

test('hackathon exception is explicit and requires a valid pinned installed certificate', () => {
  assert.equal(signingPolicy().hackathonDebugSigning, false)
  assert.throws(() => signingPolicy(true), /requires the verified installed certificate/)
  assert.throws(() => signingPolicy(true, 'not-a-fingerprint'), /Invalid expected/)
  const fingerprint = 'ab'.repeat(32)
  assert.deepEqual(signingPolicy(true, fingerprint.toUpperCase()), {
    hackathonDebugSigning: true,
    expectedCertificate: fingerprint,
  })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'momints-hackathon-signing-test-'))
  try {
    // Synthetic bytes exercise JS preflight only; native KeyStore validation remains mandatory.
    fs.writeFileSync(path.join(dir, 'debug.keystore'), 'not-a-real-keystore')
    const file = path.join(dir, 'credentials.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        android: {
          keystore: {
            keystorePath: 'debug.keystore',
            keystorePassword: 'fixture',
            keyAlias: 'androiddebugkey',
            keyPassword: 'fixture',
          },
        },
      }),
    )
    assert.throws(() => readSigningCredentials(file), /debug signing key/)
    assert.equal(readSigningCredentials(file, signingPolicy(true, fingerprint)).keyAlias, 'androiddebugkey')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI strips inherited signing switches and names hackathon artifacts distinctly', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/build-submission-apk.cjs'), 'utf8')
  assert.match(source, /args.includes\('--hackathon-debug-signing'\)/)
  assert.match(source, /\^MOMINTS_ANDROID_/)
  assert.match(source, /policy.hackathonDebugSigning \? '1' : '0'/)
  assert.match(source, /hackathon-only-debug-signed-/)
})

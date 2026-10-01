// Owner-operated local release build. No cloud upload, installation or paid action.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const cp = require('node:child_process')
const crypto = require('node:crypto')

const API = 'https://api.momints.xyz'
const TREASURY = 'o4w1THGTu1ufcRUEpVn45zttpcPoQBFFSLtMYeu5HpW'
const APP_KEYS = ['EXPO_PUBLIC_ROLL_API', 'EXPO_PUBLIC_ROLL_TREASURY', 'EXPO_PUBLIC_SOLANA_RPC']
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

function readAppEnvironment(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (!match || !APP_KEYS.includes(match[1])) continue
    let value = match[2]
    if (/^["']/.test(value)) {
      const quote = value[0]
      const end = value.lastIndexOf(quote)
      if (end <= 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw new Error('Invalid quoted app configuration')
      value = value.slice(1, end)
    } else value = value.replace(/\s+#.*$/, '').trim()
    if (/\$\{|[\r\n\u0000]/.test(value)) throw new Error('App configuration must use literal values')
    values[match[1]] = value
  }
  if (values.EXPO_PUBLIC_ROLL_API !== API || values.EXPO_PUBLIC_ROLL_TREASURY !== TREASURY) {
    throw new Error('Submission API/treasury must match the existing production configuration')
  }
  let rpc
  try {
    rpc = new URL(values.EXPO_PUBLIC_SOLANA_RPC)
  } catch {
    throw new Error('A client-appropriate mainnet RPC URL is required')
  }
  if (rpc.protocol !== 'https:' || /devnet|testnet|replace|your_|example/i.test(rpc.href)) {
    throw new Error('Use the existing client-appropriate HTTPS mainnet RPC configuration')
  }
  return values
}

function signingPolicy(hackathonDebugSigning = false, expectedCertificate = '') {
  const certificate = expectedCertificate.replace(/:/g, '').toLowerCase()
  if (certificate && !/^[a-f0-9]{64}$/.test(certificate))
    throw new Error('Invalid expected signing certificate SHA-256')
  if (hackathonDebugSigning && !certificate)
    throw new Error('Hackathon debug signing requires the verified installed certificate SHA-256')
  return { hackathonDebugSigning, expectedCertificate: certificate }
}

function readSigningCredentials(filename, policy = signingPolicy()) {
  let data
  try {
    data = JSON.parse(fs.readFileSync(filename, 'utf8'))
  } catch {
    throw new Error('Existing Android release credentials JSON is required')
  }
  const signing = data.android?.keystore
  for (const key of ['keystorePath', 'keystorePassword', 'keyAlias', 'keyPassword']) {
    if (typeof signing?.[key] !== 'string' || !signing[key])
      throw new Error('Missing Android release credential field: ' + key)
  }
  if (
    !policy.hackathonDebugSigning &&
    (signing.keyAlias.toLowerCase() === 'androiddebugkey' ||
      path.basename(signing.keystorePath).toLowerCase() === 'debug.keystore')
  ) {
    throw new Error('A debug signing key cannot be substituted for the existing release identity')
  }
  const store = path.resolve(path.dirname(filename), signing.keystorePath)
  if (!fs.existsSync(store)) throw new Error('The existing Android release keystore file is unavailable')
  return signing
}

function redactor(secrets) {
  return (text) =>
    secrets
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)
      .reduce((result, secret) => result.split(secret).join('[REDACTED]'), text)
}

async function main(args) {
  const root = path.resolve(__dirname, '..')
  const git = (...params) =>
    cp
      .execFileSync('git', params, { cwd: root, maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString()
      .trim()
  if (git('branch', '--show-current') !== 'codex/submission-candidate')
    throw new Error('Build only from codex/submission-candidate')
  if (git('diff', 'HEAD', '--name-only') || git('diff', '--cached', '--name-only'))
    throw new Error('Freeze tracked source before building')
  const prepareOnly = args.includes('--prepare-only')
  const resume = args.includes('--resume')
  const allowedFlags = [
    '--prepare-only',
    '--resume',
    '--credentials',
    '--app-env',
    '--hackathon-debug-signing',
    '--expected-cert-sha256',
  ]
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (!allowedFlags.includes(args[i])) throw new Error('Unknown build option')
    if (!['--prepare-only', '--resume', '--hackathon-debug-signing'].includes(args[i])) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing build option value')
      options[args[i].slice(2)] = args[++i]
    }
  }
  const policy = signingPolicy(args.includes('--hackathon-debug-signing'), options['expected-cert-sha256'])
  const appEnvFile = path.resolve(root, options['app-env'] || '.env')
  const app = readAppEnvironment(fs.readFileSync(appEnvFile, 'utf8'))
  const credentials = path.resolve(root, options.credentials || 'credentials.json')
  const signing = prepareOnly ? null : readSigningCredentials(credentials, policy)
  const redact = redactor([app.EXPO_PUBLIC_SOLANA_RPC, signing?.keystorePassword, signing?.keyPassword])
  const commit = git('rev-parse', 'HEAD')
  const tree = git('rev-parse', 'HEAD^{tree}')
  const out = path.join(root, '.expo', 'submission-candidate-apk-20261001')
  const source = path.join(root, '.expo', 'apk-src-' + commit.slice(0, 8))
  fs.mkdirSync(out, { recursive: true })
  if (fs.existsSync(source) && !resume)
    throw new Error('Build export already exists; preserve it and use --resume after verification')
  if (!fs.existsSync(source) && resume) throw new Error('No isolated committed export to resume')
  if (!resume) fs.mkdirSync(source)
  const files = git('ls-tree', '-r', '--name-only', commit).split('\n')
  if (
    files.some(
      (f) =>
        /^(?:\.expo\/|\.claude\/|worker\/filmstock-drafts\/|worker\/\.(?:production-evidence|staging-secrets)\/)|(?:^|\/)(?:credentials\.json|[^/]+\.(?:jks|keystore|pem|key))$/.test(
          f,
        ) ||
        (/(?:^|\/)(?:\.env[^/]*|\.dev\.vars[^/]*)$/.test(f) && !f.endsWith('.example')),
    )
  )
    throw new Error('Private material in committed export')
  const archive = path.join(out, 'source-' + commit.slice(0, 8) + '.zip')
  const reportFile = path.join(out, 'build-' + commit.slice(0, 8) + '.json')
  let previous
  if (resume) {
    previous = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
    if (
      previous.commit !== commit ||
      previous.tree !== tree ||
      previous.source !== source ||
      !previous.steps.some((s) => s.label === 'prebuild' && s.exitCode === 0)
    )
      throw new Error('Isolated export provenance/prebuild mismatch')
  } else {
    git('archive', '--format=zip', '--output=' + archive, commit)
    cp.execFileSync('tar.exe', ['-xf', archive, '-C', source])
  }
  const inputHashes =
    previous?.inputHashes || Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(source, f)))]))
  if (
    resume &&
    files.some(
      (f) => f !== 'src/uniwind-types.d.ts' && sha256(fs.readFileSync(path.join(source, f))) !== inputHashes[f],
    )
  )
    throw new Error('Committed export changed; do not resume')
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk')
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^EXPO_PUBLIC_|^MOMINTS_ANDROID_|^(?:IRYS_FUNDING_KEY|OPS_AUTH_TOKEN|DISCORD_WEBHOOK_URL|PINATA_JWT|SOLANA_RPC_URL)/.test(
          key,
        ),
    ),
  )
  const env = {
    ...baseEnv,
    ...app,
    NODE_ENV: 'production',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1',
    CI: '1',
    ANDROID_HOME: sdk,
  }
  const report = {
    ...previous,
    status: 'preparing',
    commit,
    tree,
    source,
    inputHashes,
    node: process.version,
    app: { api: API, treasury: TREASURY, rpc: '[client RPC redacted]' },
    abi: ['arm64-v8a'],
    credentialsCopied: false,
    signingPolicy: policy.hackathonDebugSigning
      ? 'hackathon-only debug-signed; not dApp Store release'
      : 'non-debug release',
    expectedCertificateSha256: policy.expectedCertificate || null,
    steps: previous?.steps || [],
  }
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  async function run(label, executable, params, cwd = source, overrides = {}) {
    console.log('Local build step: ' + label)
    const started = Date.now()
    let output = ''
    const isBatch = executable.endsWith('.bat')
    if (isBatch && [executable, ...params].some((p) => /["&|<>^%\r\n]/.test(p)))
      throw new Error('Unsafe native command path')
    const child = isBatch
      ? cp.spawn([executable, ...params].map((p) => '"' + p + '"').join(' '), {
          cwd,
          env: { ...env, ...overrides },
          shell: true,
          windowsHide: true,
        })
      : cp.spawn(executable, params, { cwd, env: { ...env, ...overrides }, windowsHide: true })
    child.stdout.on('data', (data) => {
      output += data
    })
    child.stderr.on('data', (data) => {
      output += data
    })
    const timer = setInterval(() => console.log('Still running local step: ' + label), 30000)
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    }).finally(() => clearInterval(timer))
    const sanitized = redact(output)
    fs.writeFileSync(path.join(out, commit.slice(0, 8) + '-' + label + '.log'), sanitized)
    report.steps.push({ label, exitCode: code, elapsedMs: Date.now() - started })
    save()
    if (code !== 0) throw new Error('Local step failed: ' + label + '; inspect the private redacted log')
    // Parse original tool receipts internally; credential redaction can change entry names.
    // Only the sanitized copy is persisted, and callers never print the raw receipt.
    return output
  }
  try {
    const npm = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (!resume) {
      await run('npm-ci', process.execPath, [npm, 'ci', '--include=dev', '--no-audit', '--no-fund'])
      await run('prebuild', process.execPath, [
        'node_modules/expo/bin/cli',
        'prebuild',
        '--platform',
        'android',
        '--no-install',
      ])
    }
    const sourceChanges = files.filter((f) => sha256(fs.readFileSync(path.join(source, f))) !== inputHashes[f])
    report.generatedSourceChanges = sourceChanges
    if (sourceChanges.some((f) => f !== 'src/uniwind-types.d.ts'))
      throw new Error('Prebuild modified maintained committed source')
    if (prepareOnly) {
      report.status = 'prepared; signing and assembly not run'
      save()
      console.log(JSON.stringify({ status: report.status, commit, source, reportFile }))
      return
    }
    const gradle = path.join(source, 'android', 'gradlew.bat')
    const buildLog = await run(
      'assemble-release',
      gradle,
      [
        '--no-daemon',
        '--init-script',
        '../scripts/android-release.init.gradle',
        'app:assembleRelease',
        '-PreactNativeArchitectures=arm64-v8a',
        '--max-workers=2',
      ],
      path.join(source, 'android'),
      {
        MOMINTS_ANDROID_CREDENTIALS: credentials,
        MOMINTS_ANDROID_HACKATHON_DEBUG_SIGNING: policy.hackathonDebugSigning ? '1' : '0',
        MOMINTS_ANDROID_EXPECTED_CERT_SHA256: policy.expectedCertificate,
      },
    )
    const expectedCert = buildLog.match(/Momints release signer SHA-256: ([a-f0-9]{64})/)?.[1]
    if (!expectedCert) throw new Error('Established release signing receipt missing')
    const apk = path.join(source, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    const tools = path.join(sdk, 'build-tools', '36.0.0')
    const signature = await run('apk-signature', path.join(tools, 'apksigner.bat'), [
      'verify',
      '--verbose',
      '--print-certs',
      apk,
    ])
    const certificate = signature.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1]?.toLowerCase()
    if (certificate !== expectedCert) throw new Error('APK certificate does not match verified release key')
    const badging = await run('apk-badging', path.join(tools, 'aapt2.exe'), ['dump', 'badging', apk])
    if (
      !badging.includes("name='com.momints.app'") ||
      badging.includes('application-debuggable') ||
      !badging.includes("'arm64-v8a'")
    )
      throw new Error('APK package/debug/ABI verification failed')
    const members = await run('apk-entries', 'tar.exe', ['-tf', apk])
    if (!members.includes('assets/index.android.bundle')) throw new Error('Embedded release JavaScript missing')
    const destination = path.join(
      out,
      'momints-' +
        (policy.hackathonDebugSigning ? 'hackathon-only-debug-signed-' : 'submission-') +
        commit.slice(0, 8) +
        '-arm64.apk',
    )
    fs.copyFileSync(apk, destination)
    report.apk = {
      path: destination,
      sha256: sha256(fs.readFileSync(destination)),
      bytes: fs.statSync(destination).size,
      certificateSha256: certificate,
    }
    report.status = 'signed standalone APK built; static basic checks passed; extended audit required'
    save()
    console.log(JSON.stringify({ status: report.status, commit, apk: report.apk, reportFile }))
  } catch (error) {
    report.status = 'blocked'
    report.error = redact(error.message)
    save()
    throw new Error(report.error)
  }
}

module.exports = { readAppEnvironment, readSigningCredentials, signingPolicy, redactor }
if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })

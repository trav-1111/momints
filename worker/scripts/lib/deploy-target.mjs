import { resolve } from 'node:path'
import { isIP } from 'node:net'

const TARGETS = Object.freeze({
  production: Object.freeze({
    name: 'production',
    config: 'wrangler.toml',
    bucket: 'momints-filmstocks',
    requiredOrigin: 'https://api.momints.xyz',
  }),
})

export function resolveDeployTarget(argv, env, workerRoot) {
  const targetIndex = argv.indexOf('--target')
  const name = targetIndex === -1 ? 'production' : argv[targetIndex + 1]
  if (!name || !TARGETS[name]) {
    throw new Error(
      'Filmstock deploy target must be `production`. The former staging service was promoted; provision a new isolated sandbox before staging writes.',
    )
  }

  const target = TARGETS[name]
  const connectIpIndex = argv.indexOf('--connect-ip')
  const connectIp = connectIpIndex === -1 ? undefined : argv[connectIpIndex + 1]
  if (connectIpIndex !== -1 && !connectIp) throw new Error('--connect-ip requires an IP address')
  if (connectIp && (target.name !== 'production' || isIP(connectIp) === 0)) {
    throw new Error('--connect-ip accepts only a valid IP for the explicit production target')
  }
  const rawBaseUrl = env.FILMSTOCK_SMOKE_BASE_URL?.replace(/\/$/, '')
  if (!rawBaseUrl) {
    throw new Error('FILMSTOCK_SMOKE_BASE_URL is required for immutable remote preflight and smoke tests')
  }
  let origin
  try {
    origin = new URL(rawBaseUrl).origin
  } catch {
    throw new Error('FILMSTOCK_SMOKE_BASE_URL must be an absolute HTTPS origin')
  }
  if (!rawBaseUrl.startsWith('https://') || origin !== rawBaseUrl) {
    throw new Error('FILMSTOCK_SMOKE_BASE_URL must be an HTTPS origin without a path')
  }
  if (target.requiredOrigin && origin !== target.requiredOrigin) {
    throw new Error(`Refusing ${target.name} deployment against unexpected origin ${origin}`)
  }
  return {
    ...target,
    baseUrl: origin,
    connectIp,
    verifyOnly: argv.includes('--verify-only'),
    configPath: resolve(workerRoot, target.config),
  }
}

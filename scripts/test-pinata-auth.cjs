/**
 * Calls Pinata testAuthentication with Bearer JWT from .env.
 * Prints HTTP status only (never prints the JWT).
 * Usage: npm run test:pinata-auth
 */
const fs = require('fs')
const path = require('path')

const envPath = path.join(__dirname, '..', '.env')

if (!fs.existsSync(envPath)) {
  console.error('No .env at', path.resolve(envPath))
  process.exit(1)
}

let text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '')

function parseJwtLine(rawLine) {
  let v = rawLine.replace(/^\s*EXPO_PUBLIC_PINATA_JWT\s*=\s*/, '').trimEnd()
  if (v.endsWith('\r')) v = v.slice(0, -1)
  v = v.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim()
  }
  if (!v.startsWith('"') && !v.startsWith("'")) {
    const hash = v.indexOf(' #')
    if (hash >= 0) v = v.slice(0, hash).trim()
  }
  return v
}

const lines = text.split('\n')
let jwt = ''
for (const line of lines) {
  if (/^\s*EXPO_PUBLIC_PINATA_JWT\s*=/.test(line)) {
    const parsed = parseJwtLine(line)
    if (parsed.length > jwt.length) jwt = parsed
  }
}

if (!jwt || !jwt.startsWith('eyJ')) {
  console.error('Invalid or missing EXPO_PUBLIC_PINATA_JWT in .env (expect long JWT starting with eyJ). Run: npm run check:pinata-env')
  process.exit(1)
}

const url = 'https://api.pinata.cloud/data/testAuthentication'

;(async () => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    })
    const bodySnippet = (await res.text()).slice(0, 120)
    console.log('Pinata testAuthentication HTTP status:', res.status, res.ok ? '(ok)' : '(failed)')
    if (!res.ok) {
      console.log('Response body (truncated):', bodySnippet.replace(/\s+/g, ' '))
      process.exit(1)
    }
    console.log('Pinata JWT is accepted for this endpoint.')
  } catch (e) {
    console.error('Request error:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
})()

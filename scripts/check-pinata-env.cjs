/**
 * Verifies .env contains EXPO_PUBLIC_PINATA_JWT (length + JWT shape only; never prints the secret).
 * Run from project root: npm run check:pinata-env
 *
 * Uses the LONGEST value among all matching lines (first match alone often stays a 20-char placeholder
 * if a duplicate key exists).
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const envPath = path.join(root, '.env')

if (!fs.existsSync(envPath)) {
  console.error('No .env file at', path.resolve(envPath))
  process.exit(1)
}

let text = fs.readFileSync(envPath, 'utf8')
text = text.replace(/^\uFEFF/, '')

function parseValue(rawLine) {
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
const hits = []
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  if (/^\s*EXPO_PUBLIC_PINATA_JWT\s*=/.test(line)) {
    hits.push({ lineNum: i + 1, value: parseValue(line) })
  }
}

if (!hits.length) {
  console.error('EXPO_PUBLIC_PINATA_JWT is not set in', path.resolve(envPath))
  process.exit(1)
}

if (hits.length > 1) {
  console.warn(
    `Warning: ${hits.length} EXPO_PUBLIC_PINATA_JWT lines (lines: ${hits.map((h) => h.lineNum).join(', ')}). Using the longest value — remove duplicate keys and keep a single JWT line.`
  )
}

const v = hits.reduce((best, h) => (h.value.length > best.length ? h.value : best), '')

console.log('Resolved .env path:', path.resolve(envPath))
console.log('EXPO_PUBLIC_PINATA_JWT length (longest assignment):', v.length)
console.log('Looks like a JWT (starts with eyJ):', v.startsWith('eyJ'))
console.log(
  'First 3 chars of value (sanity check):',
  v.length ? JSON.stringify(v.slice(0, 3)) : '(empty)',
  '— expect "eyJ" for a real Pinata JWT'
)

const shellLen = (process.env.EXPO_PUBLIC_PINATA_JWT || '').trim().length
if (shellLen > 0 && shellLen !== v.length) {
  console.warn(
    `Note: Your shell also has EXPO_PUBLIC_PINATA_JWT (length ${shellLen}). Expo/Metro may override .env — align or unset in the shell.`
  )
}

if (v.length < 80 || !v.startsWith('eyJ')) {
  console.error(
    '\nFix: In Pinata open the key you created → use Copy on the long JWT (often shown once in a modal). Paste the entire token on ONE line:\n' +
      '  EXPO_PUBLIC_PINATA_JWT=eyJ...very-long...\n' +
      'Save .env, then run this script again. A real JWT is usually 200+ characters.'
  )
  process.exit(1)
}

console.log('OK: .env Pinata JWT shape looks valid for the SDK.')

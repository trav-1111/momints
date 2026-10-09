'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const assetLinksPath = path.join(root, '.well-known/assetlinks.json')
const appJsonPath = path.join(root, 'app.json')

test('.well-known/assetlinks.json is valid and matches app package and certificate configuration', () => {
  assert.ok(fs.existsSync(assetLinksPath), '.well-known/assetlinks.json must exist')
  
  const raw = fs.readFileSync(assetLinksPath, 'utf8')
  const assetLinks = JSON.parse(raw)
  assert.ok(Array.isArray(assetLinks), 'assetlinks.json must be an array')
  assert.ok(assetLinks.length >= 1, 'assetlinks.json must contain at least one entry')

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  const expectedPackage = appJson.expo?.android?.package
  assert.ok(expectedPackage, 'app.json must declare android.package')

  const entry = assetLinks[0]
  assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls'])
  assert.equal(entry.target?.namespace, 'android_app')
  assert.equal(entry.target?.package_name, expectedPackage)

  const fingerprints = entry.target?.sha256_cert_fingerprints
  assert.ok(Array.isArray(fingerprints), 'sha256_cert_fingerprints must be an array')
  assert.ok(fingerprints.length >= 1, 'must contain at least one cert fingerprint')

  for (const fp of fingerprints) {
    assert.match(
      fp,
      /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
      'fingerprint must be 32 colon-separated uppercase hex pairs',
    )
  }

  // Debug/Seeker installed certificate fingerprint
  const debugCertFp = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C'
  assert.ok(
    fingerprints.includes(debugCertFp),
    'assetlinks.json must include debug certificate fingerprint for development and Seeker testing',
  )
})

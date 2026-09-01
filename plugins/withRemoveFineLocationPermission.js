const { withAndroidManifest } = require('expo/config-plugins')

const TOOLS_NS = 'http://schemas.android.com/tools'
const FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION'

// expo-location's own AAR manifest declares ACCESS_FINE_LOCATION
// unconditionally — Gradle's manifest merger pulls it in regardless of
// app.json's `android.permissions` list, which only ever ADDS permissions,
// never removes ones a dependency already declares. The only way to drop it
// is a tools:node="remove" directive in the app module's own manifest, which
// Gradle's merger honors at build time. App only ever requests
// Location.Accuracy.Low (src/services/captureMetadata.ts), so this doesn't
// change any runtime behavior — it stops the manifest from asking for
// precision the app never uses.
function withRemoveFineLocationPermission(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? TOOLS_NS

    if (!Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = []
    }
    manifest['uses-permission'] = manifest['uses-permission'].filter(
      (perm) => perm.$['android:name'] !== FINE_LOCATION,
    )
    manifest['uses-permission'].push({
      $: { 'android:name': FINE_LOCATION, 'tools:node': 'remove' },
    })

    return config
  })
}

module.exports = withRemoveFineLocationPermission

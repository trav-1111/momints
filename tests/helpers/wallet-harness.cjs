const React = require('react')
const { sourceLoader } = require('./load-source.cjs')

const WALLET = '9ybS1vSt3EkAQs8RTUXHqubusumc1ZMDeVM9oEsk2zB1'
const OTHER_WALLET = '11111111111111111111111111111112'
const noop = () => {}

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function walletHarness(overrides = {}) {
  const listeners = new Set()
  const calls = []
  const wallet = { account: { address: WALLET }, connect: noop, disconnect: noop }
  const sdk = {
    lookup: async () => [{ domain: 'trav.skr' }],
    primary: () => {
      throw new Error('Unable to find MainDomain account')
    },
  }
  class Parser {
    getParsedAllUserDomains(address) {
      calls.push({ method: 'all', address: String(address) })
      return sdk.lookup(address)
    }
    getParsedAllUserDomainsFromTld(address, tld) {
      calls.push({ method: 'tld', address: String(address), tld })
      return sdk.lookup(address, tld)
    }
    getMainDomain() {
      return sdk.primary()
    }
  }
  const appState = {
    currentState: 'active',
    addEventListener: (_name, listener) => {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
  }
  const rn = {
    AppState: appState,
    Platform: { OS: 'android' },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    TextInput: 'TextInput',
    Image: 'Image',
    ScrollView: 'ScrollView',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    ActivityIndicator: 'ActivityIndicator',
    Modal: (props) => (props.visible ? React.createElement('Modal', props) : null),
    StyleSheet: { absoluteFill: {}, create: (value) => value },
    Alert: { alert: noop },
    Linking: { openURL: noop },
    Vibration: { vibrate: noop },
    Animated: {
      Value: class {
        setValue() {}
      },
      View: 'Animated.View',
    },
    useWindowDimensions: () => ({ width: 400, height: 800 }),
  }
  const store = (state) => Object.assign((selector) => selector(state), { getState: () => state })
  const photo = { id: 'photo-1', uri: 'file:///test.jpg', capturedAt: 1, action: 'pending' }
  const photos = store({ photos: [photo] })
  const queue = { queue: [], mintHistory: [], addToQueue: noop }
  const session = store({ activeMode: 'quick', activeRoll: null })
  const gesture = { onStart: () => gesture, onUpdate: () => gesture, runOnJS: () => gesture }
  const mocks = {
    'react-native': rn,
    '@wallet-ui/react-native-kit': { useMobileWallet: () => wallet },
    '@onsol/tldparser': { TldParser: Parser },
    'src/store/network.ts': { getClusterRpc: () => 'https://rpc.example.test' },
    'expo-router': {
      useRouter: () => ({ push: noop, back: noop, replace: noop }),
      useLocalSearchParams: () => ({ id: photo.id }),
    },
    '@react-navigation/native': { useIsFocused: () => true },
    'react-native-vision-camera': {
      Camera: 'Camera',
      useCameraDevice: () => ({ hasFlash: true }),
      useCameraPermission: () => ({ hasPermission: true, requestPermission: noop }),
    },
    'react-native-gesture-handler': { Gesture: { Pinch: () => gesture }, GestureDetector: 'GestureDetector' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-file-system': {},
    'src/store/photos.ts': { usePhotoStore: photos },
    'src/store/session.ts': { useSessionStore: session },
    'src/store/mintQueue.ts': { useMintQueue: store(queue) },
    'src/store/rollRegistry.ts': { useRollRegistry: store({ rolls: [] }) },
    'src/store/locationSettings.ts': { useLocationSettingsStore: store({ granularity: 'off' }) },
    'src/services/captureMetadata.ts': { resolveLocation: () => 'Not recorded' },
    'src/services/filmProcessor.ts': {},
    'src/services/cropImage.ts': {},
    'src/services/compressImage.ts': {},
    'src/components/AspectFramingOverlay.tsx': { AspectFramingOverlay: 'AspectFramingOverlay' },
    'src/components/icons.tsx': new Proxy({}, { get: (_target, key) => String(key) }),
    ...overrides,
  }
  const load = sourceLoader(mocks)
  return {
    load,
    sdk,
    calls,
    wallet,
    queue,
    listeners,
    appState,
    foreground: () => {
      appState.currentState = 'active'
      for (const listener of listeners) listener('active')
    },
  }
}

function textNodes(renderer) {
  return renderer.root.findAllByType('Text').map((node) => node.children.join(''))
}

module.exports = { walletHarness, WALLET, OTHER_WALLET, deferred, textNodes }

const crypto = require('node:crypto')
const { sourceLoader } = require('./load-source.cjs')

function vaultHarness() {
  const files = new Map(),
    directories = new Set(),
    secrets = new Map()
  let detail,
    reads = 0,
    inFlight = false,
    failManifestWrite = false
  const uri = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/')
  class File {
    constructor(...parts) {
      this.uri = uri(parts)
    }
    get exists() {
      return files.has(this.uri)
    }
    write(value) {
      if (failManifestWrite === 'torn' && /manifest-[ab]\.enc$/.test(this.uri)) {
        files.set(this.uri, Buffer.from(value).subarray(0, 15))
        return
      }
      if (failManifestWrite && /manifest-[ab]\.enc$/.test(this.uri)) throw Error('disk full')
      files.set(this.uri, Buffer.from(value))
    }
    async bytes() {
      if (!this.exists) throw Error('file missing')
      return Buffer.from(files.get(this.uri))
    }
    async text() {
      return this.textSync()
    }
    textSync() {
      return files.get(this.uri).toString('utf8')
    }
    delete() {
      files.delete(this.uri)
    }
  }
  class Directory {
    constructor(...parts) {
      this.uri = uri(parts)
    }
    get exists() {
      return directories.has(this.uri)
    }
    create() {
      directories.add(this.uri)
    }
    delete() {
      for (const key of files.keys()) if (key.startsWith(this.uri + '/')) files.delete(key)
      directories.delete(this.uri)
    }
  }
  const load = sourceLoader({
    'react-native-quick-crypto': crypto,
    '@craftzdog/react-native-buffer': { Buffer },
    'expo-file-system': { File, Directory, Paths: { document: 'file:///document' } },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
      getItemAsync: async (key) => secrets.get(key) ?? null,
      setItemAsync: async (key, value) => secrets.set(key, value),
      deleteItemAsync: async (key) => secrets.delete(key),
    },
    'src/services/mint.ts': {},
    'src/store/network.ts': {},
    'src/services/rollCapability.ts': {},
    'src/services/permanentAsset.ts': {},
    'src/services/rollApi.ts': {
      getWorkerRoll: async () => {
        reads++
        if (!detail) throw Error('offline')
        return structuredClone(typeof detail === 'function' ? detail(reads) : detail)
      },
      hasInFlightRollFrameMints: () => inFlight,
    },
    'src/services/imagePrivacy.ts': {
      CAPTURE_TEMP_DIRECTORY: new Directory('file:///cache'),
      deleteCapture: (path) => files.delete(path),
      normalizeArweaveUri: (path) => path,
      isPermanentArweaveUri: () => true,
    },
  })
  const vault = load('src/services/rollVault.ts')
  const roll = {
    id: 'roll-one',
    name: '2026-10-11.01',
    size: 12,
    developed: true,
    collectionAddress: 'collection',
    frameIds: [],
    film: { mode: 'color', filmStockId: 'test-film-v1' },
    aspect: 'full',
    startedAt: 0,
  }
  async function add(id, number) {
    // Complete SOF dimensions plus unique payload for the real JPEG header parser.
    const bytes = Buffer.alloc(64, Number(id))
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0f, 0x00, 0x14])
    const artifact = {
      mime: 'image/jpeg',
      byteLength: bytes.length,
      width: 20,
      height: 15,
      imageHash: crypto.createHash('sha256').update(bytes).digest('hex'),
      renderer: 'native-egl-v2',
      recipeSha256: 'a'.repeat(64),
    }
    const photo = {
      id,
      uri: `file:///capture-${id}.jpg`,
      rollId: roll.id,
      rollName: roll.name,
      rollFrameNumber: number,
      capturedAt: Number(id),
      artifact,
      filmStockId: 'test-film-v1',
      action: 'mint',
    }
    files.set(photo.uri, bytes)
    const vaultUri = await vault.persistRollFrame(photo, number)
    roll.frameIds.push(id)
    return { ...photo, uri: vaultUri }
  }
  const remote = (photo, frameIndex, status = 'MINTED') => ({ frameIndex, status, ...photo.artifact })
  const server = (frames) => ({
    collectionAddress: roll.collectionAddress,
    wallet: 'owner',
    size: roll.size,
    status: 'OPEN',
    frames,
  })
  return {
    load,
    vault,
    roll,
    files,
    add,
    remote,
    server,
    get reads() {
      return reads
    },
    set detail(value) {
      detail = value
    },
    set inFlight(value) {
      inFlight = value
    },
    set failManifestWrite(value) {
      failManifestWrite = value
    },
  }
}
module.exports = { vaultHarness }

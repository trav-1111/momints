'use strict'

const { sourceLoader } = require('./load-source.cjs')

const stockIds = [
  'momints-aura-400',
  'momints-neon-800t',
  'momints-vivid-50',
  'momints-amber-200',
  'momints-silver-400',
  'momints-bali-400',
  'momints-martha',
]
const assetMocks = Object.fromEntries(stockIds.map((id, index) => [`../../assets/luts/${id}.png`, index + 1]))

// Only native boundaries are mocked. Stock lookup and processor code are real.
function makeProcessorHarness(options = {}) {
  const calls = { events: [], assets: [], uniforms: [], resources: [], matrices: [], shaderSource: null }
  function step(name) {
    calls.events.push(name)
    if (options.fail === name) throw new Error(`injected ${name} failure`)
  }
  function resource(name, fields = {}) {
    const value = {
      name,
      disposed: 0,
      dispose() {
        this.disposed += 1
      },
      ...fields,
    }
    calls.resources.push(value)
    return value
  }
  const sourceImage = () =>
    resource('sourceImage', {
      width: () => 640,
      height: () => 480,
      makeShaderOptions: () => {
        step('imageShader')
        return resource('imageShader')
      },
    })
  const lutImage = () =>
    resource('lutImage', {
      width: () => (options.invalidLut ? 32 : 1024),
      height: () => 32,
      makeShaderOptions: () => {
        step('lutShader')
        return resource('lutShader')
      },
    })
  const files = new Map([['file:///captures/original.jpg', new Uint8Array([1, 2, 3])]])
  class File {
    constructor(first, second) {
      this.uri = second ? `${first.uri}/${second}` : first
    }
    get parentDirectory() {
      return { uri: this.uri.slice(0, this.uri.lastIndexOf('/')) }
    }
    get name() {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1)
    }
    get exists() {
      return files.has(this.uri)
    }
    get size() {
      return files.get(this.uri)?.length ?? 0
    }
    async bytes() {
      step(this.uri.includes('lut') ? 'readLut' : 'read')
      if (this.uri.includes('lut')) return new Uint8Array([4])
      if (!files.has(this.uri)) throw new Error('Missing source fixture')
      return files.get(this.uri)
    }
    create(options) {
      step('create')
      if (options?.overwrite !== false) throw new Error('Output reservation must forbid overwrites')
      if (files.has(this.uri)) throw new Error('File already exists')
      files.set(this.uri, new Uint8Array())
    }
    write(bytes) {
      step('write')
      files.set(this.uri, options.shortWrite ? bytes.slice(0, 1) : bytes)
    }
    delete() {
      step(this.uri.endsWith('/original.jpg') ? 'deleteSource' : 'deleteOutput')
      files.delete(this.uri)
    }
  }
  let outputSequence = 0
  const load = sourceLoader({
    ...assetMocks,
    uuid: { v4: () => options.outputId ?? `fixture-${++outputSequence}` },
    'expo-file-system': { File },
    'expo-asset': {
      Asset: {
        loadAsync: async (asset) => {
          step('asset')
          calls.assets.push(asset)
          return options.noAsset
            ? []
            : [{ localUri: `file:///lut-${asset}.png`, uri: 'https://unused.invalid/lut.png' }]
        },
      },
    },
    '@shopify/react-native-skia': {
      ImageFormat: { JPEG: 'jpeg' },
      TileMode: { Clamp: 'clamp' },
      FilterMode: { Linear: 'linear' },
      MipmapMode: { None: 'none' },
      Skia: {
        Data: { fromBytes: (bytes) => resource('data', { bytes }) },
        Image: {
          MakeImageFromEncoded: (data) => {
            const kind = data.bytes[0] === 4 ? 'decodeLut' : 'decodeSource'
            step(kind)
            return options.nullAt === kind ? null : kind === 'decodeSource' ? sourceImage() : lutImage()
          },
        },
        Surface: {
          MakeOffscreen: () => {
            step('surface')
            if (options.nullAt === 'surface') return null
            return resource('surface', {
              getCanvas: () => ({
                clear: () => step('clear'),
                drawImage: () => step('drawImage'),
                drawImageRect: () => step('drawImageRect'),
                drawRect: () => step('drawRect'),
                save: () => step('save'),
                translate: () => step('translate'),
                restore: () => step('restore'),
              }),
              flush: () => step('flush'),
              makeImageSnapshot: () => {
                step('snapshot')
                return resource('snapshot', {
                  encodeToBytes: () => {
                    step('encode')
                    return new Uint8Array(options.emptyEncode ? [] : [9, 8, 7])
                  },
                })
              },
            })
          },
        },
        Paint: () => resource('paint', { setShader() {}, setColorFilter() {} }),
        ColorFilter: {
          MakeMatrix: (matrix) => {
            calls.matrices.push(matrix)
            return resource('colorFilter')
          },
        },
        RuntimeEffect: {
          Make: (sksl) => {
            step('compile')
            calls.shaderSource = sksl
            if (options.nullAt === 'compile') return null
            return resource('effect', {
              makeShaderWithChildren: (uniforms, children) => {
                step('filmShader')
                calls.uniforms.push({ uniforms, children })
                return resource('filmShader')
              },
            })
          },
        },
        Color: (c) => c,
        XYWHRect: () => ({}),
      },
    },
  })
  return { processor: load('src/services/filmProcessor.ts'), calls, files }
}

module.exports = { makeProcessorHarness, assetMocks, stockIds }

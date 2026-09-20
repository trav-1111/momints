'use strict'

// Serialized by the emulator runner. This function runs inside Hermes/Skia,
// without mocked native bindings, and writes only its own fixture directory.
async function runNativeFilmCases(shaderSource, vectors, runId) {
  const findModule = (suffix) => {
    const entry = Array.from(globalThis.__r.getModules()).find(([, m]) => m.verboseName === suffix)
    if (!entry) throw new Error('Metro module not loaded: ' + suffix)
    return globalThis.__r(entry[0])
  }
  const { Skia, ColorType, AlphaType, ImageFormat, TileMode, FilterMode, MipmapMode } = findModule(
    'node_modules/@shopify/react-native-skia/src/index.ts',
  )
  const { File, Directory, Paths } = findModule('node_modules/expo-file-system/src/index.ts')
  const { applyFilm, FILM_SHADER_SKSL } = findModule('src/services/filmProcessor.ts')
  if (FILM_SHADER_SKSL !== shaderSource) throw new Error('Stale Metro film shader; reload the app and retry')
  const { FILM_STOCKS } = findModule('src/config/filmStocks.ts')
  const directory = new Directory(Paths.cache, runId)
  directory.create()
  const results = []
  const artifacts = []
  const assert = (value, message) => {
    if (!value) throw new Error(message)
  }
  async function check(name, fn) {
    try {
      results.push({ name, pass: true, evidence: await fn() })
    } catch (error) {
      results.push({ name, pass: false, error: String(error) })
    }
  }
  const info = (width, height) => ({ width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul })
  function imageFrom(width, height, rgbAt) {
    const bytes = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        bytes.set([...rgbAt(x, y), 255], (y * width + x) * 4)
      }
    const data = Skia.Data.fromBytes(bytes)
    try {
      const image = Skia.Image.MakeImage(info(width, height), data, width * 4)
      assert(image, 'fixture image')
      return image
    } finally {
      data.dispose()
    }
  }
  const effect = Skia.RuntimeEffect.Make(shaderSource)
  assert(effect, 'Production SkSL must compile on native Skia')
  const identity = imageFrom(1024, 32, (x, y) => [
    Math.round(((x % 32) * 255) / 31),
    Math.round((y * 255) / 31),
    Math.round((Math.floor(x / 32) * 255) / 31),
  ])
  const defaults = [0, 1, 0.25, 0, 8, 0, 0]
  function render(source, uniforms = defaults, lut = identity) {
    const resources = []
    const own = (value) => {
      assert(value, 'native allocation')
      resources.push(value)
      return value
    }
    try {
      const surface = own(Skia.Surface.MakeOffscreen(source.width(), source.height()))
      const imageShader = own(
        source.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None),
      )
      const lutShader = own(lut.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None))
      const shader = own(effect.makeShaderWithChildren(uniforms, [imageShader, lutShader]))
      const paint = own(Skia.Paint())
      paint.setShader(shader)
      surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, source.width(), source.height()), paint)
      surface.flush()
      const snapshot = own(surface.makeImageSnapshot())
      const pixels = snapshot.readPixels(0, 0, info(source.width(), source.height()))
      assert(pixels, 'readPixels')
      return {
        pixels: Array.from(pixels),
        png: snapshot.encodeToBase64(ImageFormat.PNG),
        width: source.width(),
        height: source.height(),
      }
    } finally {
      resources.reverse().forEach((r) => r.dispose())
    }
  }
  const pixel = (result, x, y) => result.pixels.slice((y * result.width + x) * 4, (y * result.width + x) * 4 + 3)
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
  const neutral = imageFrom(64, 64, () => [128, 128, 128])
  const night = imageFrom(64, 64, (x, y) => (x >= 30 && x < 34 && y >= 30 && y < 34 ? [255, 255, 255] : [0, 0, 0]))
  try {
    await check('native LUT channel order, endpoints, slice edges and trilinear interpolation', () => {
      const probes = vectors.concat(Array.from({ length: 32 }, (_, b) => [57, 193, Math.round((b * 255) / 31)]))
      const source = imageFrom(probes.length, 1, (x) => probes[x])
      try {
        const result = render(source, [0, 1, 0, 0, 0, 1, 0])
        let maxError = 0
        probes.forEach((rgb, x) =>
          pixel(result, x, 0).forEach((v, c) => {
            maxError = Math.max(maxError, Math.abs(v - rgb[c]))
          }),
        )
        assert(maxError <= 2, 'identity LUT max error ' + maxError)
        return { probes: probes.length, maxChannelError: maxError, tolerance: 2 }
      } finally {
        source.dispose()
      }
    })
    await check('native B&W output is neutral for saturated inputs', () => {
      const source = imageFrom(vectors.length, 1, (x) => vectors[x])
      try {
        const result = render(source, [0, 1, 0, 0, 0, 0, 1])
        vectors.forEach((rgb, x) => {
          const out = pixel(result, x, 0)
          assert(out[0] === out[1] && out[1] === out[2], 'neutral RGB')
          assert(Math.abs(out[0] - (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114)) <= 1, 'Rec.601')
        })
        return { probes: vectors.length, tolerance: 1 }
      } finally {
        source.dispose()
      }
    })
    await check('native grain is repeatable, seed-sensitive, neutral and luminance-weighted', () => {
      const uniforms = [0.14, 2.2, 0.123, 0, 0, 0, 1]
      const first = render(neutral, uniforms)
      const repeat = render(neutral, uniforms)
      const changed = render(neutral, [0.14, 2.2, 0.456, 0, 0, 0, 1])
      assert(same(first.pixels, repeat.pixels), 'same seed differs')
      assert(!same(first.pixels, changed.pixels), 'different seed identical')
      const values = first.pixels.filter((_, i) => i % 4 === 0)
      const range = Math.max(...values) - Math.min(...values)
      assert(range > 20, 'grain absent')
      for (let i = 0; i < first.pixels.length; i += 4)
        assert(
          first.pixels[i] === first.pixels[i + 1] && first.pixels[i] === first.pixels[i + 2],
          'grain introduces chroma',
        )
      const dark = imageFrom(64, 64, () => [16, 16, 16])
      try {
        const darkValues = render(dark, uniforms).pixels.filter((_, i) => i % 4 === 0)
        const darkRange = Math.max(...darkValues) - Math.min(...darkValues)
        assert(darkRange < range / 2, 'grain luminance weighting')
        artifacts.push({ name: 'grain.png', base64: first.png })
        return { sameSeedIdentical: true, differentSeedDiffers: true, midtoneRange: range, shadowRange: darkRange }
      } finally {
        dark.dispose()
      }
    })
    await check('native halation spreads isolated highlights with a red tint at the configured radius', () => {
      const result = render(night, [0, 1, 0, 0.45, 8, 0, 0])
      const off = render(night)
      const halo = pixel(result, 23, 31)
      assert(halo[0] > 5 && halo[0] > halo[1] && halo[1] >= halo[2], 'missing red halo: ' + halo)
      assert(same(pixel(off, 23, 31), [0, 0, 0]), 'disabled halo')
      assert(same(pixel(result, 0, 0), [0, 0, 0]), 'glow far from highlight')
      const wider = render(night, [0, 1, 0, 0.45, 16, 0, 0])
      assert(pixel(wider, 15, 31)[0] > 5 && pixel(result, 15, 31)[0] === 0, 'radius does not move halo')
      assert(same(render(neutral, [0, 1, 0, 0.45, 8, 0, 0]).pixels, render(neutral).pixels), 'midtone halation')
      artifacts.push({ name: 'halation.png', base64: result.png })
      return { haloRGB: halo, radius: 8, widerRadius: 16 }
    })
    // Owned synthetic chart: neutral ramp, colour swatches, spatial texture, and night light.
    const chart = imageFrom(320, 192, (x, y) => {
      if (y < 48) return [(x * 255) / 319, (x * 255) / 319, (x * 255) / 319]
      if (y < 96) return vectors[Math.floor(x / 10) % vectors.length]
      if (x < 160) return ((x >> 2) + (y >> 2)) % 2 ? [67, 105, 51] : [155, 126, 98]
      return x >= 232 && x < 248 && y >= 136 && y < 152 ? [255, 255, 255] : [8, 12, 20]
    })
    try {
      const encoded = chart.encodeToBytes(ImageFormat.PNG)
      artifacts.push({ name: 'original.png', base64: chart.encodeToBase64(ImageFormat.PNG) })
      for (const stock of FILM_STOCKS) {
        await check('applyFilm native decode/LUT/JPEG/write: ' + stock.id, async () => {
          const input = new File(directory, stock.id + '.png')
          input.write(encoded)
          const start = Date.now()
          const outputUri = await applyFilm(input.uri, { mode: stock.mode, stockId: stock.id })
          const output = new File(outputUri)
          const outputBytes = await output.bytes()
          if (stock.id === 'standard-color') {
            assert(
              outputUri === input.uri && same(Array.from(encoded), Array.from(outputBytes)),
              'Standard Color changed',
            )
          } else {
            assert(outputUri !== input.uri && !input.exists, 'render fell back or source was not replaced')
            assert(outputBytes[0] === 255 && outputBytes[1] === 216, 'not JPEG')
          }
          const data = Skia.Data.fromBytes(outputBytes)
          const decoded = Skia.Image.MakeImageFromEncoded(data)
          data.dispose()
          assert(decoded, 'saved output decodes')
          try {
            assert(decoded.width() === 320 && decoded.height() === 192, 'dimensions changed')
            if (stock.mode === 'bw') {
              const pixels = decoded.readPixels(0, 0, info(320, 192))
              for (let i = 0; i < pixels.length; i += 4)
                assert(
                  Math.abs(pixels[i] - pixels[i + 1]) <= 1 && Math.abs(pixels[i] - pixels[i + 2]) <= 1,
                  'JPEG chroma in B&W',
                )
            }
            artifacts.push({ name: stock.id + '.png', base64: decoded.encodeToBase64(ImageFormat.PNG) })
          } finally {
            decoded.dispose()
          }
          return {
            width: 320,
            height: 192,
            bytes: output.size,
            elapsedMs: Date.now() - start,
            sourcePreserved: input.exists,
            outputUri,
          }
        })
      }
      await check('native concurrent renders retain distinct outputs and refuse overwrite reservations', async () => {
        const inputs = [new File(directory, 'concurrent-a.png'), new File(directory, 'concurrent-b.png')]
        inputs.forEach((input) => input.write(encoded))
        const outputs = await Promise.all(
          inputs.map((input) => applyFilm(input.uri, { mode: 'bw', stockId: 'standard-bw' })),
        )
        assert(outputs[0] !== outputs[1], 'concurrent outputs collided')
        for (let index = 0; index < outputs.length; index++) {
          const output = new File(outputs[index])
          assert(output.exists && !inputs[index].exists, 'render did not commit')
          assert(/photo_[0-9a-f-]{36}_film\.jpg$/.test(output.uri), 'stale renderer: expected UUID filename')
          const before = Array.from(await output.bytes())
          let rejected = false
          try {
            output.create({ overwrite: false })
          } catch {
            rejected = true
          }
          assert(rejected, 'native reservation overwrote an existing file')
          assert(same(before, Array.from(await output.bytes())), 'existing output bytes changed')
        }
        return { distinctOutputs: true, existingFilesPreserved: true, outputUris: outputs }
      })
    } finally {
      chart.dispose()
    }
    await check('native decoder failure preserves the original bytes', async () => {
      const bad = new File(directory, 'invalid.png')
      bad.write(new Uint8Array([1, 2, 3]))
      const returned = await applyFilm(bad.uri, { mode: 'color', stockId: 'momints-aura-400' })
      assert(returned === bad.uri && bad.exists && same(Array.from(await bad.bytes()), [1, 2, 3]), 'original lost')
      return { sourcePreserved: true }
    })
  } finally {
    identity.dispose()
    neutral.dispose()
    night.dispose()
    effect.dispose()
  }
  return { results, artifacts, fixtureDirectory: directory.uri }
}

module.exports = { runNativeFilmCases }

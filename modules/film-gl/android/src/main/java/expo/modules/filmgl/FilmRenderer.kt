package expo.modules.filmgl

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorSpace
import android.graphics.Paint
import android.graphics.Matrix
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.GLES30
import android.opengl.GLUtils
import android.os.Build
import org.json.JSONObject
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** A fresh isolated EGL context for each frame; no GL handles escape render(). */
class FilmRenderer(private val context: Context) {
  private fun hash(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))
  private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun input(uri: String): InputStream = when {
    uri.startsWith("content://") -> context.contentResolver.openInputStream(Uri.parse(uri)) ?: error("Input unavailable")
    uri.startsWith("file://") -> FileInputStream(File(Uri.parse(uri).path ?: error("Invalid file URI")))
    else -> error("Input must be a local URI")
  }
  private fun bounded(value: Double, name: String, min: Double, max: Double): Float {
    require(value.isFinite() && value >= min && value <= max) { "Invalid $name" }
    return value.toFloat()
  }
  private fun recipe(options: FilmGlOptionsRecord): JSONObject {
    require(options.filmStockId.matches(Regex("^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$"))) { "Invalid film ID" }
    require(hash(options.recipeJson.toByteArray(Charsets.UTF_8)) == options.recipeSha256) { "Recipe checksum mismatch" }
    val recipe = JSONObject(options.recipeJson)
    require(recipe.getString("filmStockId") == options.filmStockId) { "Recipe identity mismatch" }
    when (recipe.getInt("schemaVersion")) {
      1 -> {
        val matrix = recipe.getJSONArray("colorMatrix")
        require(matrix.length() == 20) { "Invalid legacy matrix" }
        for (i in 0 until 20) require(matrix.getDouble(i).isFinite()) { "Invalid matrix value" }
        require(options.lutUri == null) { "Unexpected legacy LUT" }
      }
      2 -> {
        require(recipe.getString("inputColorSpace") == "sRGB" && recipe.getString("outputColorSpace") == "sRGB") { "Unsupported colour space" }
        require(recipe.getInt("minimumEngineVersion") == 2) { "Unsupported engine version" }
        val lut = recipe.getJSONObject("lut")
        require(lut.getString("format") == "momints-lut" && lut.getInt("size") == 33) { "Unsupported LUT format" }
        require(lut.getString("sha256").matches(Regex("^[a-f0-9]{64}$"))) { "Invalid LUT checksum" }
        require(!options.lutUri.isNullOrEmpty()) { "Required LUT is missing" }
        bounded(lut.getDouble("intensity"), "lut.intensity", 0.0, 1.0)
      }
      else -> error("Unsupported recipe version")
    }
    require(options.seed.isFinite() && options.seed >= 0f && options.seed < 100000f) { "Invalid grain seed" }
    require(options.jpegQuality in 1..100) { "Invalid JPEG quality" }
    return recipe
  }
  private fun runtimeLut(uri: String, expectedHash: String): ByteArray {
    val bytes = input(uri).use { it.readBytes() }
    require(hash(bytes) == expectedHash) { "LUT checksum mismatch" }
    require(bytes.size == 16 + 33 * 33 * 33 * 4) { "Invalid LUT byte length" }
    require(String(bytes, 0, 8, Charsets.US_ASCII) == "MOMLUT01") { "Invalid LUT header" }
    val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    require(header.getShort(8).toInt() == 33 && header.getShort(10).toInt() == 4 &&
      header.getInt(12) == 33 * 33 * 33 * 4) { "Invalid LUT dimensions" }
    return bytes // Same verified bytes are uploaded; no second read of the LUT file.
  }
  private fun checkGl(stage: String) {
    val code = GLES30.glGetError()
    check(code == GLES30.GL_NO_ERROR) { "OpenGL failed at $stage (0x${code.toString(16)})" }
  }
  private fun referenceColor(rgb: IntArray, recipe: JSONObject, lut: ByteArray?): FloatArray {
    val original = floatArrayOf(rgb[0] / 255f, rgb[1] / 255f, rgb[2] / 255f, 1f)
    if (lut == null) {
      val matrix = recipe.getJSONArray("colorMatrix")
      return FloatArray(4) { row ->
        var value = matrix.getDouble(row * 5 + 4).toFloat()
        for (channel in 0..3) value += original[channel] * matrix.getDouble(row * 5 + channel).toFloat()
        value.coerceIn(0f, 1f)
      }
    }
    val scaled = FloatArray(3) { original[it] * 32f }
    val lower = IntArray(3) { scaled[it].toInt() }
    val fraction = FloatArray(3) { scaled[it] - lower[it] }
    val mapped = FloatArray(3)
    for (blue in 0..1) for (green in 0..1) for (red in 0..1) {
      val steps = intArrayOf(red, green, blue)
      var weight = 1f
      for (channel in 0..2) weight *= if (steps[channel] == 0) 1f - fraction[channel] else fraction[channel]
      val r = (lower[0] + red).coerceAtMost(32)
      val g = (lower[1] + green).coerceAtMost(32)
      val b = (lower[2] + blue).coerceAtMost(32)
      val offset = 16 + (g * 33 * 33 + b * 33 + r) * 4
      for (channel in 0..2) mapped[channel] += (lut[offset + channel].toInt() and 255) / 255f * weight
    }
    val intensity = recipe.getJSONObject("lut").getDouble("intensity").toFloat()
    return FloatArray(4) { if (it == 3) 1f else original[it] * (1f - intensity) + mapped[it] * intensity }
  }
  /** Exercise the actual program, LUT texture/interpolation and colour channels.
   * Spatial effects are disabled only for this synthetic canary, then restored.
   * This is a runtime fail-safe, not full-image visual/golden validation.
   */
  private fun verifyGpuPixels(program: Int, testTexture: Int, recipe: JSONObject, lut: ByteArray?) {
    GLES30.glUniform2f(GLES30.glGetUniformLocation(program, "imageSize"), 1f, 1f)
    for (name in arrayOf("exposureEv", "grainAmount", "halationAmount", "bloomAmount", "sharpnessAmount", "vignetteAmount"))
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, name), 0f)
    GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, testTexture)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glViewport(0, 0, 1, 1)
    val pixel = ByteBuffer.allocateDirect(4)
    val output = ByteBuffer.allocateDirect(4)
    val samples = arrayOf(intArrayOf(0, 0, 0), intArrayOf(255, 255, 255), intArrayOf(127, 127, 127),
      intArrayOf(255, 0, 0), intArrayOf(0, 255, 0), intArrayOf(0, 0, 255),
      intArrayOf(37, 149, 223), intArrayOf(230, 91, 17))
    for (rgb in samples) {
      pixel.clear(); pixel.put(rgb[0].toByte()).put(rgb[1].toByte()).put(rgb[2].toByte()).put(255.toByte()).rewind()
      GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, 1, 1, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixel)
      GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
      output.clear()
      GLES30.glReadPixels(0, 0, 1, 1, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, output)
      checkGl("pixel verification")
      val expected = referenceColor(rgb, recipe, lut)
      for (channel in 0..3) {
        val actual = output.get(channel).toInt() and 255
        check(kotlin.math.abs(actual - expected[channel] * 255f) <= 2f) { "GPU film pixel verification failed" }
      }
    }
  }
  private fun shader(type: Int, source: String): Int {
    val id = GLES30.glCreateShader(type)
    check(id != 0) { "Shader allocation failed" }
    try {
      GLES30.glShaderSource(id, source)
      GLES30.glCompileShader(id)
      val status = IntArray(1)
      GLES30.glGetShaderiv(id, GLES30.GL_COMPILE_STATUS, status, 0)
      check(status[0] != 0) { "Shader compile failed: ${GLES30.glGetShaderInfoLog(id)}" }
      return id
    } catch (error: Throwable) { GLES30.glDeleteShader(id); throw error }
  }
  private fun program(): Int {
    var vertex = 0
    var fragment = 0
    var id = 0
    try {
      vertex = shader(GLES30.GL_VERTEX_SHADER, "#version 300 es\nlayout(location=0) in vec2 p; void main(){gl_Position=vec4(p,0,1);}")
      val fragmentSource = context.assets.open("momints-film-v2.glsl").bufferedReader().use { it.readText() }
      fragment = shader(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
      id = GLES30.glCreateProgram()
      check(id != 0) { "Program allocation failed" }
      GLES30.glAttachShader(id, vertex)
      GLES30.glAttachShader(id, fragment)
      GLES30.glLinkProgram(id)
      val status = IntArray(1)
      GLES30.glGetProgramiv(id, GLES30.GL_LINK_STATUS, status, 0)
      check(status[0] != 0) { "Program link failed: ${GLES30.glGetProgramInfoLog(id)}" }
      return id
    } catch (error: Throwable) {
      if (id != 0) GLES30.glDeleteProgram(id)
      throw error
    } finally {
      if (vertex != 0) GLES30.glDeleteShader(vertex)
      if (fragment != 0) GLES30.glDeleteShader(fragment)
    }
  }
  fun render(options: FilmGlOptionsRecord): Map<String, Any?> {
    val recipe = recipe(options)
    val legacy = recipe.getInt("schemaVersion") == 1
    val lutHash = if (legacy) null else recipe.getJSONObject("lut").getString("sha256")
    val lutBytes = if (legacy) null else runtimeLut(options.lutUri!!, lutHash!!)
    require(options.outputUri.startsWith("file://")) { "Output must be an app cache file" }
    val output = File(Uri.parse(options.outputUri).path ?: error("Invalid output URI")).canonicalFile
    require(output.path.startsWith(context.cacheDir.canonicalPath + File.separator)) { "Output is outside app cache" }
    if (options.inputUri.startsWith("file://")) require(output != File(Uri.parse(options.inputUri).path!!).canonicalFile) { "Output cannot replace input" }
    require(output.parentFile?.isDirectory == true) { "Output directory missing" }
    require(output.createNewFile()) { "Output already exists" }
    var source: Bitmap? = null
    var normalized: Bitmap? = null
    var result: Bitmap? = null
    var display = EGL14.EGL_NO_DISPLAY
    var eglContext = EGL14.EGL_NO_CONTEXT
    var surface = EGL14.EGL_NO_SURFACE
    var initialized = false
    var current = false
    var succeeded = false
    val textures = IntArray(5)
    val fbos = IntArray(2)
    val vaos = IntArray(1)
    val vbos = IntArray(1)
    var shaderProgram = 0
    try {
      val decode = BitmapFactory.Options().apply {
        inPreferredConfig = Bitmap.Config.ARGB_8888
        if (Build.VERSION.SDK_INT >= 26) inPreferredColorSpace = ColorSpace.get(ColorSpace.Named.SRGB)
      }
      source = input(options.inputUri).use { BitmapFactory.decodeStream(it, null, decode) } ?: error("Source decode failed")
      val orientation = input(options.inputUri).use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
      val sw = source.width.toFloat()
      val sh = source.height.toFloat()
      val swapped = orientation in 5..8
      val width = if (swapped) source.height else source.width
      val height = if (swapped) source.width else source.height
      val transform = Matrix()
      val values = when (orientation) {
        2 -> floatArrayOf(-1f, 0f, sw, 0f, 1f, 0f, 0f, 0f, 1f)
        3 -> floatArrayOf(-1f, 0f, sw, 0f, -1f, sh, 0f, 0f, 1f)
        4 -> floatArrayOf(1f, 0f, 0f, 0f, -1f, sh, 0f, 0f, 1f)
        5 -> floatArrayOf(0f, 1f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)
        6 -> floatArrayOf(0f, -1f, sh, 1f, 0f, 0f, 0f, 0f, 1f)
        7 -> floatArrayOf(0f, -1f, sh, -1f, 0f, sw, 0f, 0f, 1f)
        8 -> floatArrayOf(0f, 1f, 0f, -1f, 0f, sw, 0f, 0f, 1f)
        else -> floatArrayOf(1f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f)
      }
      transform.setValues(values)
      // Explicit SDR sRGB destination: Canvas colour-converts embedded profiles.
      normalized = if (Build.VERSION.SDK_INT >= 26)
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888, false, ColorSpace.get(ColorSpace.Named.SRGB))
      else Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      // Bake display orientation into pixels; do not copy location/camera EXIF.
      Canvas(normalized).drawBitmap(source, transform, Paint())
      source.recycle(); source = null
      display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      check(display != EGL14.EGL_NO_DISPLAY) { "EGL display unavailable" }
      val versions = IntArray(2)
      check(EGL14.eglInitialize(display, versions, 0, versions, 1)) { "EGL initialization failed" }
      initialized = true
      val configs = arrayOfNulls<EGLConfig>(1)
      val count = IntArray(1)
      val attrs = intArrayOf(EGL14.EGL_RENDERABLE_TYPE, 0x40, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
        EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_NONE)
      check(EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, count, 0) && count[0] > 0) { "EGL config unavailable" }
      eglContext = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT,
        intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
      check(eglContext != EGL14.EGL_NO_CONTEXT) { "EGL context failed" }
      surface = EGL14.eglCreatePbufferSurface(display, configs[0],
        intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
      check(surface != EGL14.EGL_NO_SURFACE) { "EGL surface failed" }
      check(EGL14.eglMakeCurrent(display, surface, surface, eglContext)) { "EGL activation failed" }
      current = true
      val limit = IntArray(1)
      GLES30.glGetIntegerv(GLES30.GL_MAX_TEXTURE_SIZE, limit, 0)
      require(width <= limit[0] && height <= limit[0]) { "Image exceeds GPU texture limit" }
      GLES30.glGenTextures(5, textures, 0)
      fun bindTexture(index: Int) {
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[index])
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
      }
      bindTexture(0)
      GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, width, height, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null)
      GLES30.glGenFramebuffers(2, fbos, 0)
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbos[0])
      GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, textures[0], 0)
      check(GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) == GLES30.GL_FRAMEBUFFER_COMPLETE) { "Framebuffer incomplete" }
      bindTexture(1)
      GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, normalized, 0)
      normalized.recycle(); normalized = null
      if (lutBytes != null) {
        bindTexture(2)
        val pixels = ByteBuffer.allocateDirect(lutBytes.size - 16).put(lutBytes, 16, lutBytes.size - 16)
        pixels.rewind()
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, 33 * 33, 33, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixels)
      } else {
        // Complete the sampler even for the legacy branch that does not read it.
        bindTexture(2)
        GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, 1, 1, 0,
          GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, ByteBuffer.allocateDirect(4).putInt(-1).rewind())
      }
      checkGl("texture upload")
      shaderProgram = program()
      GLES30.glUseProgram(shaderProgram)
      GLES30.glGenVertexArrays(1, vaos, 0); GLES30.glBindVertexArray(vaos[0])
      GLES30.glGenBuffers(1, vbos, 0); GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbos[0])
      val vertices = ByteBuffer.allocateDirect(32).order(ByteOrder.nativeOrder()).asFloatBuffer()
      vertices.put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)).position(0)
      GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, 32, vertices, GLES30.GL_STATIC_DRAW)
      GLES30.glEnableVertexAttribArray(0); GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 8, 0)
      GLES30.glActiveTexture(GLES30.GL_TEXTURE0); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[1])
      GLES30.glUniform1i(GLES30.glGetUniformLocation(shaderProgram, "uImage"), 0)
      GLES30.glActiveTexture(GLES30.GL_TEXTURE1); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[2])
      GLES30.glUniform1i(GLES30.glGetUniformLocation(shaderProgram, "uLut"), 1)
      GLES30.glUniform2f(GLES30.glGetUniformLocation(shaderProgram, "imageSize"), width.toFloat(), height.toFloat())
      val uniforms = mutableMapOf<String, Float>()
      fun uniform(name: String, value: Float) {
        uniforms[name] = value
        GLES30.glUniform1f(GLES30.glGetUniformLocation(shaderProgram, name), value)
      }
      uniform("legacy", if (legacy) 1f else 0f)
      if (legacy) {
        val m = recipe.getJSONArray("colorMatrix")
        for (row in 0..3) GLES30.glUniform4f(GLES30.glGetUniformLocation(shaderProgram, "matrix$row"),
          m.getDouble(row * 5).toFloat(), m.getDouble(row * 5 + 1).toFloat(), m.getDouble(row * 5 + 2).toFloat(), m.getDouble(row * 5 + 3).toFloat())
        GLES30.glUniform4f(GLES30.glGetUniformLocation(shaderProgram, "matrixOffset"),
          m.getDouble(4).toFloat(), m.getDouble(9).toFloat(), m.getDouble(14).toFloat(), m.getDouble(19).toFloat())
      } else {
        uniform("lutSize", 33f); uniform("lutIntensity", recipe.getJSONObject("lut").getDouble("intensity").toFloat())
        fun effect(name: String, section: String, key: String, default: Double, min: Double, max: Double) =
          uniform(name, bounded(recipe.optJSONObject(section)?.optDouble(key, default) ?: default, name, min, max))
        effect("exposureEv", "exposure", "ev", 0.0, -2.0, 2.0)
        effect("grainAmount", "grain", "amount", 0.0, 0.0, 1.0)
        effect("grainSize", "grain", "size", 0.0, 0.0, 1.0)
        effect("grainRoughness", "grain", "roughness", 0.0, 0.0, 1.0)
        effect("halationAmount", "halation", "amount", 0.0, 0.0, 1.0)
        effect("halationRadius", "halation", "radius", 0.0, 0.0, 1.0)
        effect("bloomAmount", "bloom", "amount", 0.0, 0.0, 1.0)
        effect("bloomRadius", "bloom", "radius", recipe.optJSONObject("halation")?.optDouble("radius", 0.0) ?: 0.0, 0.0, 1.0)
        effect("sharpnessAmount", "sharpness", "amount", 0.0, -1.0, 1.0)
        effect("vignetteAmount", "vignette", "amount", 0.0, 0.0, 1.0)
        uniform("seed", options.seed)
      }
      GLES30.glDisable(GLES30.GL_DITHER)
      // A separate 1x1 target keeps the canary independent of full-frame
      // tile resolves/readbacks on mobile GPUs.
      GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
      bindTexture(4)
      GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, 1, 1, 0,
        GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null)
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbos[1])
      GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
        GLES30.GL_TEXTURE_2D, textures[4], 0)
      check(GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) == GLES30.GL_FRAMEBUFFER_COMPLETE) { "Verification framebuffer incomplete" }
      verifyGpuPixels(shaderProgram, textures[3], recipe, lutBytes)
      // Restore the full recipe and captured source after the synthetic check.
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbos[0])
      for ((name, value) in uniforms) GLES30.glUniform1f(GLES30.glGetUniformLocation(shaderProgram, name), value)
      GLES30.glUniform2f(GLES30.glGetUniformLocation(shaderProgram, "imageSize"), width.toFloat(), height.toFloat())
      GLES30.glActiveTexture(GLES30.GL_TEXTURE0); GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[1])
      GLES30.glViewport(0, 0, width, height)
      GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4); GLES30.glFinish(); checkGl("render")
      val buffer = ByteBuffer.allocateDirect(Math.multiplyExact(Math.multiplyExact(width, height), 4)).order(ByteOrder.nativeOrder())
      GLES30.glReadPixels(0, 0, width, height, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, buffer)
      checkGl("readback"); buffer.rewind()
      result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      result.copyPixelsFromBuffer(buffer)
      FileOutputStream(output).use { stream ->
        check(result.compress(Bitmap.CompressFormat.JPEG, options.jpegQuality, stream)) { "JPEG encode failed" }
        stream.fd.sync()
      }
      result.recycle(); result = null
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(output.path, bounds)
      check(output.length() > 0 && bounds.outWidth == width && bounds.outHeight == height && bounds.outMimeType == "image/jpeg") { "Output verification failed" }
      val outputHash = FileInputStream(output).use { stream ->
        val digest = MessageDigest.getInstance("SHA-256")
        val chunk = ByteArray(65536)
        var length = stream.read(chunk)
        while (length >= 0) { digest.update(chunk, 0, length); length = stream.read(chunk) }
        hex(digest.digest())
      }
      succeeded = true
      return mapOf("outputUri" to options.outputUri, "filmStockId" to options.filmStockId,
        "recipeSha256" to options.recipeSha256, "lutSha256" to lutHash, "outputSha256" to outputHash,
        "width" to width, "height" to height, "renderer" to "native-egl-v2", "colorSpace" to "sRGB")
    } finally {
      source?.recycle(); normalized?.recycle(); result?.recycle()
      if (current) {
        if (vaos[0] != 0) GLES30.glDeleteVertexArrays(1, vaos, 0)
        if (vbos[0] != 0) GLES30.glDeleteBuffers(1, vbos, 0)
        if (shaderProgram != 0) GLES30.glDeleteProgram(shaderProgram)
        GLES30.glDeleteFramebuffers(2, fbos, 0)
        GLES30.glDeleteTextures(5, textures, 0)
        EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
      }
      if (surface != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, surface)
      if (eglContext != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, eglContext)
      if (initialized) EGL14.eglTerminate(display)
      EGL14.eglReleaseThread()
      if (!succeeded) output.delete()
    }
  }
}

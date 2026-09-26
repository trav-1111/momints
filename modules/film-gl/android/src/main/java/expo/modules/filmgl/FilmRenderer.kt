package expo.modules.filmgl

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.GLES30
import android.opengl.GLUtils
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val TAG = "FilmRenderer"

class FilmRenderer(private val context: Context) {

  private val vertexShaderSource = """
    #version 300 es
    layout(location = 0) in vec2 aPosition;
    layout(location = 1) in vec2 aTexCoord;

    out vec2 vTexCoord;

    void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
    }
  """.trimIndent()

  private val fragmentShaderSource = """
    #version 300 es
    precision highp float;
    precision highp sampler2D;

    in vec2 vTexCoord;
    out vec4 fragColor;

    uniform sampler2D uImage;
    uniform sampler2D uLut;
    uniform vec2 uOutputSize;
    uniform vec2 uFullImageSize;
    uniform vec4 uCropRect; // (normOriginX, normOriginY, normCropW, normCropH)

    uniform float uGrainIntensity;
    uniform float uGrainSize;
    uniform float uGrainSeed;
    uniform float uHalationIntensity;
    uniform float uHalationRadius;
    uniform float uHasLut;
    uniform float uIsBW;

    float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    vec3 sampleLut(vec3 rgb) {
        rgb = clamp(rgb, 0.0, 1.0);
        float b = rgb.b * 31.0;
        float z0 = floor(b);
        float z1 = min(z0 + 1.0, 31.0);
        float f = b - z0;

        float y = (0.5 + rgb.g * 31.0) / 32.0;
        float r = 0.5 + rgb.r * 31.0;

        vec2 uv0 = vec2((z0 * 32.0 + r) / 1024.0, y);
        vec2 uv1 = vec2((z1 * 32.0 + r) / 1024.0, y);

        vec3 col0 = texture(uLut, uv0).rgb;
        vec3 col1 = texture(uLut, uv1).rgb;

        return mix(col0, col1, f);
    }

    float highlightWeight(vec3 color) {
        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        return smoothstep(0.70, 0.95, luma);
    }

    void main() {
        vec2 srcUV = uCropRect.xy + vTexCoord * uCropRect.zw;
        vec4 base = texture(uImage, srcUV);
        vec3 color = base.rgb;

        if (uHasLut > 0.5) {
            color = sampleLut(color);
        }

        if (uHalationIntensity > 0.0) {
            vec2 r = vec2(uHalationRadius) / uFullImageSize;
            vec3 h1 = texture(uImage, srcUV + vec2(r.x, 0.0)).rgb;
            vec3 h2 = texture(uImage, srcUV - vec2(r.x, 0.0)).rgb;
            vec3 h3 = texture(uImage, srcUV + vec2(0.0, r.y)).rgb;
            vec3 h4 = texture(uImage, srcUV - vec2(0.0, r.y)).rgb;
            vec3 h5 = texture(uImage, srcUV + vec2(r.x * 0.707, r.y * 0.707)).rgb;
            vec3 h6 = texture(uImage, srcUV - vec2(r.x * 0.707, r.y * 0.707)).rgb;
            vec3 h7 = texture(uImage, srcUV + vec2(-r.x * 0.707, r.y * 0.707)).rgb;
            vec3 h8 = texture(uImage, srcUV + vec2(r.x * 0.707, -r.y * 0.707)).rgb;

            float highlight = (highlightWeight(h1) + highlightWeight(h2) + highlightWeight(h3) + highlightWeight(h4)
                             + highlightWeight(h5) + highlightWeight(h6) + highlightWeight(h7) + highlightWeight(h8)) * 0.125;
            vec3 halationTint = vec3(1.0, 0.20, 0.05);
            color += halationTint * (highlight * uHalationIntensity);
        }

        if (uIsBW > 0.5) {
            float gray = dot(color, vec3(0.299, 0.587, 0.114));
            color = vec3(gray);
        }

        if (uGrainIntensity > 0.0) {
            vec2 pixelCoord = vTexCoord * uOutputSize;
            vec2 seedOffset = vec2(uGrainSeed * 4096.0, uGrainSeed * 6627.328);
            vec2 grainCoord = (pixelCoord + seedOffset) / max(uGrainSize, 1.0);
            float n = noise(grainCoord) * 2.0 - 1.0;
            float luma = dot(color, vec3(0.299, 0.587, 0.114));
            float grainWeight = 4.0 * luma * (1.0 - luma);
            grainWeight = clamp(grainWeight, 0.1, 1.0);
            color += n * uGrainIntensity * grainWeight;
        }

        fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  """.trimIndent()

  private fun openInputStream(uriStr: String): InputStream {
    return if (uriStr.startsWith("content://")) {
      context.contentResolver.openInputStream(Uri.parse(uriStr))
        ?: throw FileNotFoundException("Could not open content URI: $uriStr")
    } else {
      val path = if (uriStr.startsWith("file://")) uriStr.substring(7) else uriStr
      FileInputStream(File(path))
    }
  }

  private fun compileShader(type: Int, source: String): Int {
    val shader = GLES30.glCreateShader(type)
    if (shader == 0) throw RuntimeException("glCreateShader failed")
    GLES30.glShaderSource(shader, source)
    GLES30.glCompileShader(shader)
    val compiled = IntArray(1)
    GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, compiled, 0)
    if (compiled[0] == 0) {
      val info = GLES30.glGetShaderInfoLog(shader)
      GLES30.glDeleteShader(shader)
      throw RuntimeException("Shader compile failed: $info")
    }
    return shader
  }

  private fun createProgram(vertSrc: String, fragSrc: String): Int {
    val vertShader = compileShader(GLES30.GL_VERTEX_SHADER, vertSrc)
    val fragShader = compileShader(GLES30.GL_FRAGMENT_SHADER, fragSrc)
    val program = GLES30.glCreateProgram()
    if (program == 0) throw RuntimeException("glCreateProgram failed")
    GLES30.glAttachShader(program, vertShader)
    GLES30.glAttachShader(program, fragShader)
    GLES30.glLinkProgram(program)
    val linked = IntArray(1)
    GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0)
    GLES30.glDeleteShader(vertShader)
    GLES30.glDeleteShader(fragShader)
    if (linked[0] == 0) {
      val info = GLES30.glGetProgramInfoLog(program)
      GLES30.glDeleteProgram(program)
      throw RuntimeException("Program link failed: $info")
    }
    return program
  }

  data class CropRect(val originX: Int, val originY: Int, val width: Int, val height: Int)

  private fun computeCropRect(w: Int, h: Int, aspect: String?): CropRect? {
    if (aspect == null || aspect == "full") return null
    val targetRatio = when (aspect) {
      "1:1" -> 1.0f
      "4:3" -> 4.0f / 3.0f
      else -> return null
    }
    val portrait = h >= w
    val longDim = if (portrait) h else w
    val shortDim = if (portrait) w else h

    var cropShort = shortDim
    var cropLong = Math.round(shortDim * targetRatio)
    if (cropLong > longDim) {
      cropLong = longDim
      cropShort = Math.round(longDim / targetRatio)
    }

    val cropW = if (portrait) cropShort else cropLong
    val cropH = if (portrait) cropLong else cropShort
    if (cropW >= w && cropH >= h) return null

    return CropRect(
      originX = Math.round((w - cropW) / 2.0f),
      originY = Math.round((h - cropH) / 2.0f),
      width = cropW,
      height = cropH
    )
  }

  fun render(options: FilmGlOptionsRecord): String {
    val decodeOpts = BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }

    val srcBitmap = openInputStream(options.inputUri).use { stream ->
      BitmapFactory.decodeStream(stream, null, decodeOpts)
    } ?: throw RuntimeException("Failed to decode input image: ${options.inputUri}")

    val srcW = srcBitmap.width
    val srcH = srcBitmap.height

    var lutBitmap: Bitmap? = null
    if (options.hasLut && !options.lutUri.isNullOrEmpty()) {
      try {
        lutBitmap = openInputStream(options.lutUri!!).use { stream ->
          BitmapFactory.decodeStream(stream, null, decodeOpts)
        }
      } catch (e: Exception) {
        Log.w(TAG, "Failed to load LUT asset: ${options.lutUri}", e)
      }
    }

    val crop = if (!options.aspect.isNullOrEmpty() && options.aspect != "full") {
      computeCropRect(srcW, srcH, options.aspect)
    } else if (options.cropWidth > 0 && options.cropHeight > 0) {
      CropRect(options.originX, options.originY, options.cropWidth, options.cropHeight)
    } else {
      null
    }

    val targetW = crop?.width ?: srcW
    val targetH = crop?.height ?: srcH

    val normOriginX = if (crop != null) crop.originX.toFloat() / srcW.toFloat() else 0f
    val normOriginY = if (crop != null) crop.originY.toFloat() / srcH.toFloat() else 0f
    val normCropW = if (crop != null) crop.width.toFloat() / srcW.toFloat() else 1f
    val normCropH = if (crop != null) crop.height.toFloat() / srcH.toFloat() else 1f

    var eglDisplay = EGL14.EGL_NO_DISPLAY
    var eglContext = EGL14.EGL_NO_CONTEXT
    var eglSurface = EGL14.EGL_NO_SURFACE

    val textures = IntArray(3) // 0: FBO, 1: Source, 2: LUT
    val fbos = IntArray(1)
    val vaos = IntArray(1)
    val vbos = IntArray(1)
    var program = 0

    val outPath = if (options.outputUri.startsWith("file://")) options.outputUri.substring(7) else options.outputUri
    val outFile = File(outPath)
    outFile.parentFile?.mkdirs()

    try {
      // 1. Initialize isolated EGLDisplay and EGLContext
      eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
      if (eglDisplay == EGL14.EGL_NO_DISPLAY) throw RuntimeException("eglGetDisplay failed")

      val version = IntArray(2)
      if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
        throw RuntimeException("eglInitialize failed")
      }

      val configAttribs = intArrayOf(
        EGL14.EGL_RENDERABLE_TYPE, 0x44, // EGL_OPENGL_ES2_BIT | EGL_OPENGL_ES3_BIT_KHR
        EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
        EGL14.EGL_RED_SIZE, 8,
        EGL14.EGL_GREEN_SIZE, 8,
        EGL14.EGL_BLUE_SIZE, 8,
        EGL14.EGL_ALPHA_SIZE, 8,
        EGL14.EGL_NONE
      )
      val configs = arrayOfNulls<EGLConfig>(1)
      val numConfigs = IntArray(1)
      if (!EGL14.eglChooseConfig(eglDisplay, configAttribs, 0, configs, 0, 1, numConfigs, 0) || numConfigs[0] == 0) {
        throw RuntimeException("eglChooseConfig failed")
      }
      val eglConfig = configs[0]!!

      val contextAttribs = intArrayOf(
        EGL14.EGL_CONTEXT_CLIENT_VERSION, 3,
        EGL14.EGL_NONE
      )
      eglContext = EGL14.eglCreateContext(eglDisplay, eglConfig, EGL14.EGL_NO_CONTEXT, contextAttribs, 0)
      if (eglContext == EGL14.EGL_NO_CONTEXT) throw RuntimeException("eglCreateContext failed")

      val pbufferAttribs = intArrayOf(
        EGL14.EGL_WIDTH, 1,
        EGL14.EGL_HEIGHT, 1,
        EGL14.EGL_NONE
      )
      eglSurface = EGL14.eglCreatePbufferSurface(eglDisplay, eglConfig, pbufferAttribs, 0)
      if (eglSurface == EGL14.EGL_NO_SURFACE) throw RuntimeException("eglCreatePbufferSurface failed")

      if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) {
        throw RuntimeException("eglMakeCurrent failed")
      }

      // 2. Set up offscreen Framebuffer Object (FBO)
      GLES30.glGenTextures(3, textures, 0)

      GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[0])
      GLES30.glTexImage2D(GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, targetW, targetH, 0, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)

      GLES30.glGenFramebuffers(1, fbos, 0)
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbos[0])
      GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, textures[0], 0)

      val fboStatus = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER)
      if (fboStatus != GLES30.GL_FRAMEBUFFER_COMPLETE) {
        throw RuntimeException("FBO status incomplete: $fboStatus")
      }

      GLES30.glViewport(0, 0, targetW, targetH)

      // 3. Upload Source Texture
      GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[1])
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
      GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
      GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, srcBitmap, 0)
      srcBitmap.recycle()

      // 4. Upload LUT Texture (if present)
      val effectiveHasLut = options.hasLut && lutBitmap != null
      if (effectiveHasLut) {
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[2])
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
        GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
        GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, lutBitmap, 0)
        lutBitmap?.recycle()
      }

      // 5. Compile and link shader program
      program = createProgram(vertexShaderSource, fragmentShaderSource)
      GLES30.glUseProgram(program)

      // 6. Set up Quad geometry
      // glReadPixels reads starting at Y=-1 (bottom of FBO).
      // Mapping Y=-1 to V=0 (top of source photo) makes row 0 in glReadPixels correspond
      // to row 0 of Bitmap (top of photo), yielding a correct upright orientation.
      val quadData = floatArrayOf(
        -1.0f, -1.0f, 0.0f, 0.0f, // Bottom-left of FBO  -> Top-left of photo
         1.0f, -1.0f, 1.0f, 0.0f, // Bottom-right of FBO -> Top-right of photo
        -1.0f,  1.0f, 0.0f, 1.0f, // Top-left of FBO     -> Bottom-left of photo
         1.0f,  1.0f, 1.0f, 1.0f  // Top-right of FBO    -> Bottom-right of photo
      )

      GLES30.glGenVertexArrays(1, vaos, 0)
      GLES30.glBindVertexArray(vaos[0])

      GLES30.glGenBuffers(1, vbos, 0)
      GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vbos[0])

      val quadBuffer = ByteBuffer.allocateDirect(quadData.size * 4)
        .order(ByteOrder.nativeOrder())
        .asFloatBuffer()
        .apply {
          put(quadData)
          position(0)
        }
      GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, quadData.size * 4, quadBuffer, GLES30.GL_STATIC_DRAW)

      GLES30.glEnableVertexAttribArray(0)
      GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 4 * 4, 0)

      GLES30.glEnableVertexAttribArray(1)
      GLES30.glVertexAttribPointer(1, 2, GLES30.GL_FLOAT, false, 4 * 4, 2 * 4)

      // 7. Bind textures and set uniforms
      GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
      GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[1])
      GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uImage"), 0)

      if (effectiveHasLut) {
        GLES30.glActiveTexture(GLES30.GL_TEXTURE1)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textures[2])
        GLES30.glUniform1i(GLES30.glGetUniformLocation(program, "uLut"), 1)
      }

      GLES30.glUniform2f(GLES30.glGetUniformLocation(program, "uOutputSize"), targetW.toFloat(), targetH.toFloat())
      GLES30.glUniform2f(GLES30.glGetUniformLocation(program, "uFullImageSize"), srcW.toFloat(), srcH.toFloat())
      GLES30.glUniform4f(GLES30.glGetUniformLocation(program, "uCropRect"), normOriginX, normOriginY, normCropW, normCropH)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uGrainIntensity"), options.grainIntensity)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uGrainSize"), options.grainSize)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uGrainSeed"), options.grainSeed)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uHalationIntensity"), options.halationIntensity)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uHalationRadius"), options.halationRadius)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uHasLut"), if (effectiveHasLut) 1.0f else 0.0f)
      GLES30.glUniform1f(GLES30.glGetUniformLocation(program, "uIsBW"), if (options.isBW) 1.0f else 0.0f)

      // 8. Draw Quad and finish
      GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
      GLES30.glFinish()

      // 9. Readback rendered pixels directly into direct ByteBuffer
      val pixelBuffer = ByteBuffer.allocateDirect(targetW * targetH * 4).order(ByteOrder.nativeOrder())
      GLES30.glReadPixels(0, 0, targetW, targetH, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, pixelBuffer)
      pixelBuffer.rewind()

      // 10. Compress to JPEG via native Android Bitmap
      val outBitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
      outBitmap.copyPixelsFromBuffer(pixelBuffer)

      FileOutputStream(outFile).use { fos ->
        outBitmap.compress(Bitmap.CompressFormat.JPEG, options.jpegQuality.coerceIn(1, 100), fos)
      }
      outBitmap.recycle()

      // 11. Preserve EXIF metadata from source image
      try {
        val srcPath = if (options.inputUri.startsWith("file://")) options.inputUri.substring(7) else options.inputUri
        val srcExif = ExifInterface(srcPath)
        val destExif = ExifInterface(outFile.absolutePath)
        val tags = arrayOf(
          ExifInterface.TAG_ORIENTATION,
          ExifInterface.TAG_DATETIME,
          ExifInterface.TAG_FLASH,
          ExifInterface.TAG_FOCAL_LENGTH,
          ExifInterface.TAG_WHITE_BALANCE,
          ExifInterface.TAG_EXPOSURE_TIME,
          ExifInterface.TAG_F_NUMBER,
          ExifInterface.TAG_PHOTOGRAPHIC_SENSITIVITY,
          ExifInterface.TAG_MAKE,
          ExifInterface.TAG_MODEL
        )
        for (tag in tags) {
          val v = srcExif.getAttribute(tag)
          if (v != null) destExif.setAttribute(tag, v)
        }
        destExif.saveAttributes()
      } catch (e: Exception) {
        Log.w(TAG, "Could not copy EXIF metadata: ${e.message}")
      }

      Log.d(TAG, "Rendered film frame via isolated OpenGL ES context -> ${outFile.absolutePath}")
      return "file://${outFile.absolutePath}"
    } finally {
      // 12. DETERMINISTIC TEARDOWN:
      // Delete GL resources
      if (vaos[0] != 0) GLES30.glDeleteVertexArrays(1, vaos, 0)
      if (vbos[0] != 0) GLES30.glDeleteBuffers(1, vbos, 0)
      if (program != 0) GLES30.glDeleteProgram(program)
      if (fbos[0] != 0) GLES30.glDeleteFramebuffers(1, fbos, 0)
      if (textures[0] != 0 || textures[1] != 0 || textures[2] != 0) {
        GLES30.glDeleteTextures(3, textures, 0)
      }

      // Destroy EGL Context & Display — forces immediate GPU driver memory reclamation to zero
      if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
        EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
        if (eglSurface != EGL14.EGL_NO_SURFACE) {
          EGL14.eglDestroySurface(eglDisplay, eglSurface)
        }
        if (eglContext != EGL14.EGL_NO_CONTEXT) {
          EGL14.eglDestroyContext(eglDisplay, eglContext)
        }
        EGL14.eglTerminate(eglDisplay)
      }
    }
  }
}

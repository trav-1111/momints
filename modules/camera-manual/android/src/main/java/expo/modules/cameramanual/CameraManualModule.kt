package expo.modules.cameramanual

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.MeteringRectangle
import android.view.View
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.camera2.impl.Camera2ImplConfig
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.impl.CaptureConfig
import androidx.camera.core.impl.Config
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executor
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class CameraStateRecord : Record {
  @Field
  var exposureMode: String = "auto"

  @Field
  var isoMode: String = "auto"

  @Field
  var shutterMode: String = "auto"

  @Field
  var iso: Int? = null

  @Field
  var shutterNs: Long? = null

  @Field
  var focusMode: String = "auto"

  @Field
  var focusDistance: Float? = null

  @Field
  var awbMode: Int = 1 // CONTROL_AWB_MODE_AUTO

  @Field
  var meteringMode: String = "matrix"

  @Field
  var meteringNormX: Float = 0.5f

  @Field
  var meteringNormY: Float = 0.5f

  @Field
  var aeLock: Boolean = false

  @Field
  var afLock: Boolean = false
}

class CameraManualModule : Module() {
  private var sensorManager: SensorManager? = null
  private var lightSensor: Sensor? = null
  @Volatile
  private var ambientLux: Float = 250f
  @Volatile
  private var liveTtlEv: Double? = null

  private val lightListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      if (event.sensor.type == Sensor.TYPE_LIGHT) {
        ambientLux = event.values[0]
      }
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  private fun ensureLightSensor() {
    if (sensorManager == null) {
      val ctx = appContext.reactContext ?: return
      val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
      val sensor = sm.getDefaultSensor(Sensor.TYPE_LIGHT)
      if (sensor != null) {
        sm.registerListener(lightListener, sensor, SensorManager.SENSOR_DELAY_UI)
        sensorManager = sm
        lightSensor = sensor
      }
    }
  }

  private val captureCallback = object : CameraCaptureSession.CaptureCallback() {
    override fun onCaptureCompleted(
      session: CameraCaptureSession,
      request: CaptureRequest,
      result: TotalCaptureResult
    ) {
      val iso = result.get(CaptureResult.SENSOR_SENSITIVITY)
      val expNs = result.get(CaptureResult.SENSOR_EXPOSURE_TIME)
      val aperture = result.get(CaptureResult.LENS_APERTURE) ?: 1.7f
      if (iso != null && expNs != null && expNs > 0) {
        val tSec = expNs / 1_000_000_000.0
        val ev = (Math.log((aperture * aperture) / tSec) / Math.log(2.0)) - (Math.log(iso / 100.0) / Math.log(2.0))
        liveTtlEv = ev
      }
    }
  }

  @OptIn(ExperimentalCamera2Interop::class)
  override fun definition() = ModuleDefinition {
    Name("CameraManual")

    Function("getAmbientLight") {
      ensureLightSensor()
      val lux = ambientLux.toDouble()
      val alsEv = if (lux > 0.05) {
        (Math.log(lux / 2.5) / Math.log(2.0)).coerceIn(-4.0, 18.0)
      } else {
        -4.0
      }
      val ttl = liveTtlEv
      val sceneEv = ttl ?: alsEv
      mapOf(
        "lux" to lux,
        "alsEv" to alsEv,
        "ttlEv" to (ttl ?: alsEv),
        "sceneEv" to sceneEv
      )
    }

    AsyncFunction("applyCameraState") { viewTag: Int, cameraId: String, state: CameraStateRecord, promise: Promise ->
      val camera = requireCamera(viewTag, cameraId)
      val future = applyCameraState(camera, viewTag, state)
      val timeoutMs = 3_000L
      acknowledge(future, camera, viewTag, cameraId, timeoutMs, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("resetToAuto") { viewTag: Int, cameraId: String, promise: Promise ->
      val camera = requireCamera(viewTag, cameraId)
      resolveImagePipeline(viewTag)?.let { applyStillCaptureConfig(it, Camera2ImplConfig.Builder().build()) }
      val future = Camera2CameraControl.from(camera.cameraControl).clearCaptureRequestOptions()
      acknowledge(future, camera, viewTag, cameraId, 3_000L, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("captureLongExposure") { viewTag: Int, cameraId: String, durationSeconds: Double, promise: Promise ->
      captureLongExposure(viewTag, cameraId, durationSeconds, promise)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      sensorManager?.unregisterListener(lightListener)
      sensorManager = null
      lightSensor = null
    }
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun requireCamera(viewTag: Int, cameraId: String): Camera {
    val camera = resolveCameraXCamera(viewTag)
      ?: throw CodedException(
        "ERR_CAMERA_NOT_BOUND",
        "No bound CameraX session on view $viewTag yet — try again once the preview is visible",
        null,
      )
    if (Camera2CameraInfo.from(camera.cameraInfo).cameraId != cameraId) {
      throw CodedException("ERR_CAMERA_SESSION_CHANGED", "The requested camera is no longer bound to this view", null)
    }
    return camera
  }

  @OptIn(ExperimentalCamera2Interop::class)
  @SuppressLint("RestrictedApi")
  private fun applyCameraState(camera: Camera, viewTag: Int, state: CameraStateRecord): ListenableFuture<Void> {
    val stillConfigBuilder = Camera2ImplConfig.Builder()
    val previewConfigBuilder = Camera2ImplConfig.Builder()

    val isManualExposure = state.exposureMode == "manual" || state.isoMode == "manual" || state.shutterMode == "manual"

    // --- Exposure (ISO / Shutter & preview clamping) ---
    if (isManualExposure) {
      val targetIso = state.iso ?: 400
      val targetShutter = state.shutterNs ?: 16_666_667L
      val previewShutter = targetShutter.coerceAtMost(100_000_000L)
      val ceiling = maxFrameDuration(camera) ?: targetShutter

      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AE_MODE,
        CaptureRequest.CONTROL_AE_MODE_OFF,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AE_MODE,
        CaptureRequest.CONTROL_AE_MODE_OFF,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )

      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_SENSITIVITY,
        targetIso,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_SENSITIVITY,
        targetIso,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )

      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_EXPOSURE_TIME,
        targetShutter,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_FRAME_DURATION,
        targetShutter.coerceAtMost(ceiling),
        Config.OptionPriority.ALWAYS_OVERRIDE
      )

      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_EXPOSURE_TIME,
        previewShutter,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.SENSOR_FRAME_DURATION,
        previewShutter,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
    } else {
      // Full Auto
      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AE_MODE,
        CaptureRequest.CONTROL_AE_MODE_ON,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AE_MODE,
        CaptureRequest.CONTROL_AE_MODE_ON,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      if (state.aeLock) {
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_LOCK,
          true,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_LOCK,
          true,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
    }

    // --- Focus ---
    if (state.focusMode == "manual") {
      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_OFF,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_OFF,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      state.focusDistance?.let {
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.LENS_FOCUS_DISTANCE,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.LENS_FOCUS_DISTANCE,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
    } else if (state.afLock) {
      stillConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_AUTO,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
      previewConfigBuilder.setCaptureRequestOptionWithPriority(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_AUTO,
        Config.OptionPriority.ALWAYS_OVERRIDE
      )
    }

    // --- White balance ---
    stillConfigBuilder.setCaptureRequestOptionWithPriority(
      CaptureRequest.CONTROL_AWB_MODE,
      state.awbMode,
      Config.OptionPriority.ALWAYS_OVERRIDE
    )
    previewConfigBuilder.setCaptureRequestOptionWithPriority(
      CaptureRequest.CONTROL_AWB_MODE,
      state.awbMode,
      Config.OptionPriority.ALWAYS_OVERRIDE
    )

    // --- Metering ---
    val array = activeArraySize(camera)
    if (array != null) {
      if (state.meteringMode != "matrix") {
        val region = when (state.meteringMode) {
          "center" -> centeredRegion(array, 0.5f, 0.5f, 0.5f)
          "spot" -> centeredRegion(array, state.meteringNormX, state.meteringNormY, 0.12f)
          else -> null
        }
        if (region != null) {
          stillConfigBuilder.setCaptureRequestOptionWithPriority(
            CaptureRequest.CONTROL_AE_REGIONS,
            arrayOf(region),
            Config.OptionPriority.ALWAYS_OVERRIDE
          )
          stillConfigBuilder.setCaptureRequestOptionWithPriority(
            CaptureRequest.CONTROL_AF_REGIONS,
            arrayOf(region),
            Config.OptionPriority.ALWAYS_OVERRIDE
          )
          previewConfigBuilder.setCaptureRequestOptionWithPriority(
            CaptureRequest.CONTROL_AE_REGIONS,
            arrayOf(region),
            Config.OptionPriority.ALWAYS_OVERRIDE
          )
          previewConfigBuilder.setCaptureRequestOptionWithPriority(
            CaptureRequest.CONTROL_AF_REGIONS,
            arrayOf(region),
            Config.OptionPriority.ALWAYS_OVERRIDE
          )
        }
      } else {
        val fullRegion = MeteringRectangle(array.left, array.top, array.width(), array.height(), 0)
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_REGIONS,
          arrayOf(fullRegion),
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_REGIONS,
          arrayOf(fullRegion),
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
    }

    // Attach repeating TTL exposure callback for match-needle light metering
    previewConfigBuilder.mutableConfig.insertOption(
      Camera2ImplConfig.SESSION_CAPTURE_CALLBACK_OPTION,
      captureCallback
    )

    val stillConfig = stillConfigBuilder.build()
    val previewConfig = previewConfigBuilder.build()

    // 1. Update the still capture pipeline (ImageCapture -> ImagePipeline -> mCaptureConfig)
    resolveImagePipeline(viewTag)?.let { applyStillCaptureConfig(it, stillConfig) }

    // 2. Update the repeating viewfinder preview (Camera2CameraControl)
    val options = CaptureRequestOptions.Builder.from(previewConfig).build()
    return Camera2CameraControl.from(camera.cameraControl).setCaptureRequestOptions(options)
  }

  private fun centeredRegion(
    array: android.graphics.Rect,
    centerXFrac: Float,
    centerYFrac: Float,
    sizeFraction: Float,
  ): MeteringRectangle {
    // Solana Seeker rear camera is mounted with 90° clockwise sensor orientation relative to portrait UI.
    // Normalized portrait screen coordinates (centerXFrac, centerYFrac) map to sensor space:
    // sensorX = centerYFrac
    // sensorY = 1.0f - centerXFrac
    val sensorNormX = centerYFrac.coerceIn(0.0f, 1.0f)
    val sensorNormY = (1.0f - centerXFrac).coerceIn(0.0f, 1.0f)

    val side = (minOf(array.width(), array.height()) * sizeFraction).toInt().coerceAtLeast(1)
    val cx = (array.left + array.width() * sensorNormX).toInt()
    val cy = (array.top + array.height() * sensorNormY).toInt()
    val left = (cx - side / 2).coerceIn(array.left, array.right - side)
    val top = (cy - side / 2).coerceIn(array.top, array.bottom - side)
    return MeteringRectangle(left, top, side, side, MeteringRectangle.METERING_WEIGHT_MAX)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun activeArraySize(camera: Camera): android.graphics.Rect? {
    return Camera2CameraInfo.from(camera.cameraInfo)
      .getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun maxFrameDuration(camera: Camera): Long? {
    return Camera2CameraInfo.from(camera.cameraInfo)
      .getCameraCharacteristic(CameraCharacteristics.SENSOR_INFO_MAX_FRAME_DURATION)
  }

  private fun acknowledge(
    future: ListenableFuture<Void>,
    camera: Camera,
    viewTag: Int,
    cameraId: String,
    timeoutMs: Long,
    promise: Promise,
  ) {
    val handler = Handler(Looper.getMainLooper())
    var settled = false
    val timeout = Runnable {
      if (!settled) {
        settled = true
        promise.reject("ERR_CAMERA_STATE_TIMEOUT", "Camera settings were not acknowledged before the deadline", null)
      }
    }
    handler.postDelayed(timeout, timeoutMs)
    future.addListener({
      if (!settled) {
        settled = true
        handler.removeCallbacks(timeout)
        try {
          future.get()
          if (requireCamera(viewTag, cameraId) !== camera) {
            promise.reject("ERR_CAMERA_SESSION_CHANGED", "Camera session changed while applying settings", null)
          } else {
            promise.resolve()
          }
        } catch (error: Throwable) {
          val cause = if (error is ExecutionException) error.cause ?: error else error
          when (cause) {
            is CodedException -> promise.reject(cause)
            is CameraControl.OperationCanceledException ->
              promise.reject("ERR_CAMERA_STATE_CANCELLED", "Camera closed or settings were superseded before acknowledgement", cause)
            else -> promise.reject("ERR_CAMERA_STATE_APPLY", "Could not confirm camera settings: ${cause.message}", cause)
          }
        }
      }
    }, Executor { handler.post(it) })
  }

  private fun resolveCameraXCamera(viewTag: Int): Camera? {
    val view = appContext.findView<View>(viewTag) ?: return null

    val sessionField = view.javaClass.getDeclaredField("cameraSession")
    sessionField.isAccessible = true
    val session = sessionField.get(view) ?: return null

    val cameraField = session.javaClass.getDeclaredField("camera")
    cameraField.isAccessible = true
    return cameraField.get(session) as? Camera
  }

  private fun resolveImagePipeline(viewTag: Int): Any? {
    val view = appContext.findView<View>(viewTag) ?: return null
    return try {
      val sessionField = view.javaClass.getDeclaredField("cameraSession")
      sessionField.isAccessible = true
      val session = sessionField.get(view) ?: return null

      val photoField = session.javaClass.getDeclaredField("photoOutput")
      photoField.isAccessible = true
      val photoOutput = photoField.get(session) ?: return null

      val takePicMgrField = photoOutput.javaClass.getDeclaredField("mTakePictureManager")
      takePicMgrField.isAccessible = true
      val takePicMgr = takePicMgrField.get(photoOutput) ?: return null

      val pipelineField = takePicMgr.javaClass.getDeclaredField("mImagePipeline")
      pipelineField.isAccessible = true
      pipelineField.get(takePicMgr)
    } catch (e: Throwable) {
      Log.w("CameraManual", "Could not resolve ImagePipeline: ${e.message}")
      null
    }
  }

  @SuppressLint("RestrictedApi")
  private fun applyStillCaptureConfig(pipeline: Any, camera2Config: Config) {
    try {
      val captureConfigField = pipeline.javaClass.getDeclaredField("mCaptureConfig")
      captureConfigField.isAccessible = true
      val currentConfig = captureConfigField.get(pipeline) as? CaptureConfig ?: return

      val builder = CaptureConfig.Builder.from(currentConfig)
      builder.setImplementationOptions(camera2Config)
      captureConfigField.set(pipeline, builder.build())
      Log.i("CameraManual", "Propagated manual settings directly to CameraX still capture pipeline")
    } catch (e: Throwable) {
      Log.w("CameraManual", "Could not update still capture pipeline: ${e.message}")
    }
  }

  private fun captureLongExposure(
    viewTag: Int,
    cameraId: String,
    durationSeconds: Double,
    promise: Promise
  ) {
    val view = appContext.findView<View>(viewTag)
    if (view == null) {
      promise.reject("ERR_VIEW_NOT_FOUND", "View $viewTag not found", null)
      return
    }

    val sessionField = view.javaClass.getDeclaredField("cameraSession")
    sessionField.isAccessible = true
    val session = sessionField.get(view) as? LifecycleOwner
    if (session == null) {
      promise.reject("ERR_SESSION_NOT_FOUND", "No active camera session for view $viewTag", null)
      return
    }

    val context = view.context
    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener({
      try {
        val provider = providerFuture.get()
        startLongExposureCapture(view, session, provider, cameraId, durationSeconds, promise)
      } catch (e: Throwable) {
        promise.reject("ERR_CAMERA_PROVIDER", "Failed to get CameraProvider: ${e.message}", e)
      }
    }, ContextCompat.getMainExecutor(context))
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun startLongExposureCapture(
    view: View,
    session: LifecycleOwner,
    provider: ProcessCameraProvider,
    cameraId: String,
    durationSeconds: Double,
    promise: Promise
  ) {
    val durationMs = (durationSeconds * 1000.0).toLong()
    val targetFrames = (durationSeconds * 30.0).roundToInt().coerceAtLeast(2)
    val cacheDir = appContext.reactContext?.cacheDir ?: view.context.cacheDir
    val outputFile = File(cacheDir, "long_exp_${System.currentTimeMillis()}.jpg")

    val resolutionSelector = androidx.camera.core.resolutionselector.ResolutionSelector.Builder()
      .setAspectRatioStrategy(androidx.camera.core.resolutionselector.AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
      .setAllowedResolutionMode(androidx.camera.core.resolutionselector.ResolutionSelector.PREFER_CAPTURE_RATE_OVER_HIGHER_RESOLUTION)
      .build()

    val analysis = ImageAnalysis.Builder()
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_BLOCK_PRODUCER)
      .setResolutionSelector(resolutionSelector)
      .build()

    val cameraSelector = CameraSelector.Builder().addCameraFilter { cameraInfos ->
      cameraInfos.filter {
        Camera2CameraInfo.from(it).cameraId == cameraId
      }
    }.build()

    val executor = Executors.newSingleThreadExecutor()
    val mainHandler = Handler(Looper.getMainLooper())
    var settled = false

    fun cleanup() {
      mainHandler.post {
        try {
          if (provider.isBound(analysis)) {
            provider.unbind(analysis)
          }
        } catch (_: Throwable) {}
      }
      executor.shutdown()
    }

    val timeoutRunnable = Runnable {
      if (!settled) {
        settled = true
        cleanup()
        promise.reject("ERR_TIMEOUT", "Long exposure capture timed out", null)
      }
    }
    mainHandler.postDelayed(timeoutRunnable, durationMs + 4000L)

    val analyzer = LongExposureAnalyzer(
      targetFrames = targetFrames,
      durationMs = durationMs,
      outputFile = outputFile,
      onComplete = { savedFile ->
        if (!settled) {
          settled = true
          mainHandler.removeCallbacks(timeoutRunnable)
          cleanup()
          promise.resolve(savedFile.absolutePath)
        }
      },
      onError = { error ->
        if (!settled) {
          settled = true
          mainHandler.removeCallbacks(timeoutRunnable)
          cleanup()
          promise.reject("ERR_CAPTURE_FAILED", "Long exposure failed: ${error.message}", error)
        }
      }
    )

    analysis.setAnalyzer(executor, analyzer)

    try {
      provider.bindToLifecycle(session, cameraSelector, analysis)
      Log.i("CameraManual", "Bound computational long exposure analysis ($durationSeconds s, $targetFrames frames)")
    } catch (e: Throwable) {
      if (!settled) {
        settled = true
        mainHandler.removeCallbacks(timeoutRunnable)
        cleanup()
        promise.reject("ERR_BIND_FAILED", "Could not bind long exposure analysis: ${e.message}", e)
      }
    }
  }
}

class LongExposureAnalyzer(
  private val targetFrames: Int,
  private val durationMs: Long,
  private val outputFile: File,
  private val onComplete: (File) -> Unit,
  private val onError: (Throwable) -> Unit
) : ImageAnalysis.Analyzer {

  @Volatile
  private var isCapturing = true
  private var framesAccumulated = 0
  private val startTimeMs = System.currentTimeMillis()
  private var rotationDegrees = 0

  private var accumulatorR: IntArray? = null
  private var accumulatorG: IntArray? = null
  private var accumulatorB: IntArray? = null
  private var rowBytes: ByteArray? = null
  private var frameWidth = 0
  private var frameHeight = 0

  override fun analyze(image: ImageProxy) {
    try {
      if (!isCapturing) return

      val width = image.width
      val height = image.height
      val plane = image.planes[0]
      val buffer = plane.buffer
      val rowStride = plane.rowStride
      val pixelStride = plane.pixelStride

      if (accumulatorR == null || frameWidth != width || frameHeight != height) {
        frameWidth = width
        frameHeight = height
        val totalPixels = width * height
        accumulatorR = IntArray(totalPixels)
        accumulatorG = IntArray(totalPixels)
        accumulatorB = IntArray(totalPixels)
        rowBytes = ByteArray(rowStride)
        rotationDegrees = image.imageInfo.rotationDegrees
      }

      val accR = accumulatorR ?: return
      val accG = accumulatorG ?: return
      val accB = accumulatorB ?: return
      val rowBuf = rowBytes ?: return

      for (y in 0 until height) {
        buffer.position(y * rowStride)
        val toRead = minOf(rowStride, buffer.remaining())
        buffer.get(rowBuf, 0, toRead)

        val rowOffset = y * width
        for (x in 0 until width) {
          val byteOffset = x * pixelStride
          val r = rowBuf[byteOffset].toInt() and 0xFF
          val g = rowBuf[byteOffset + 1].toInt() and 0xFF
          val b = rowBuf[byteOffset + 2].toInt() and 0xFF

          val pixelIndex = rowOffset + x
          accR[pixelIndex] += r
          accG[pixelIndex] += g
          accB[pixelIndex] += b
        }
      }

      framesAccumulated++

      val elapsed = System.currentTimeMillis() - startTimeMs
      if (framesAccumulated >= targetFrames || elapsed >= durationMs) {
        isCapturing = false
        saveAveragedBitmap(outputFile, rotationDegrees)
        onComplete(outputFile)
      }
    } catch (e: Throwable) {
      isCapturing = false
      onError(e)
    } finally {
      image.close()
    }
  }

  private fun saveAveragedBitmap(destFile: File, rotation: Int) {
    val accR = accumulatorR ?: return
    val accG = accumulatorG ?: return
    val accB = accumulatorB ?: return
    val totalPixels = frameWidth * frameHeight
    val count = framesAccumulated.toFloat().coerceAtLeast(1f)

    val outputPixels = IntArray(totalPixels)
    for (i in 0 until totalPixels) {
      val r = (accR[i] / count).toInt().coerceIn(0, 255)
      val g = (accG[i] / count).toInt().coerceIn(0, 255)
      val b = (accB[i] / count).toInt().coerceIn(0, 255)
      val a = 0xFF

      outputPixels[i] = (a shl 24) or (r shl 16) or (g shl 8) or b
    }

    var bitmap = Bitmap.createBitmap(outputPixels, frameWidth, frameHeight, Bitmap.Config.ARGB_8888)

    if (rotation != 0) {
      val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
      val rotatedBitmap = Bitmap.createBitmap(bitmap, 0, 0, frameWidth, frameHeight, matrix, true)
      bitmap.recycle()
      bitmap = rotatedBitmap
    }

    destFile.parentFile?.mkdirs()
    FileOutputStream(destFile).use { fos ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, 95, fos)
    }
    bitmap.recycle()
  }
}


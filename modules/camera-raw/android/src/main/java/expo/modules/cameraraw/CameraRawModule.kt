package expo.modules.cameraraw

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.DngCreator
import android.hardware.camera2.TotalCaptureResult
import android.media.ExifInterface
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.View
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class RawCaptureOptionsRecord : Record {
  @Field
  var viewTag: Int? = null

  @Field
  var cameraId: String = "0"

  @Field
  var includeJpeg: Boolean = true

  @Field
  var manualIso: Int? = null

  @Field
  var manualExposureNs: Long? = null

  @Field
  var manualFocusDistance: Float? = null

  @Field
  var whiteBalanceMode: Int? = null

  @Field
  var orientation: Int? = null
}

class CameraRawModule : Module() {
  companion object {
    private const val TAG = "CameraRaw"
    private const val CAPTURE_TIMEOUT_MS = 8000L
  }

  override fun definition() = ModuleDefinition {
    Name("CameraRaw")

    Function("isRawSupported") { cameraId: String? ->
      val targetId = cameraId ?: "0"
      val context = appContext.reactContext ?: return@Function false
      val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return@Function false
      try {
        val chars = cameraManager.getCameraCharacteristics(targetId)
        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: return@Function false
        caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to check RAW capability for camera $targetId: ${e.message}")
        false
      }
    }

    Function("getRawSensorInfo") { cameraId: String? ->
      val targetId = cameraId ?: "0"
      val context = appContext.reactContext ?: return@Function null
      val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: return@Function null
      try {
        val chars = cameraManager.getCameraCharacteristics(targetId)
        val caps = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
        val hasRaw = caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)

        val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
        val rawSizes = map?.getOutputSizes(ImageFormat.RAW_SENSOR) ?: emptyArray()
        val selectedRawSize = rawSizes.firstOrNull() ?: Size(4000, 3000)

        val cfa = chars.get(CameraCharacteristics.SENSOR_INFO_COLOR_FILTER_ARRANGEMENT) ?: -1
        val cfaName = when (cfa) {
          0 -> "RGGB"
          1 -> "GRBG"
          2 -> "GBRG"
          3 -> "BGGR"
          4 -> "RGB"
          else -> "UNKNOWN"
        }

        val whiteLevel = chars.get(CameraCharacteristics.SENSOR_INFO_WHITE_LEVEL) ?: 1023
        val blackLevelPattern = chars.get(CameraCharacteristics.SENSOR_BLACK_LEVEL_PATTERN)
        val blackLevelList = if (blackLevelPattern != null) {
          listOf(
            blackLevelPattern.getOffsetForIndex(0, 0),
            blackLevelPattern.getOffsetForIndex(1, 0),
            blackLevelPattern.getOffsetForIndex(0, 1),
            blackLevelPattern.getOffsetForIndex(1, 1)
          )
        } else {
          listOf(64, 64, 64, 64)
        }

        val isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
        val expRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
        val oisModes = chars.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
        val hasOis = oisModes?.contains(CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON) == true

        mapOf(
          "supported" to hasRaw,
          "cameraId" to targetId,
          "width" to selectedRawSize.width,
          "height" to selectedRawSize.height,
          "cfaPattern" to cfa,
          "cfaPatternName" to cfaName,
          "whiteLevel" to whiteLevel,
          "blackLevel" to blackLevelList,
          "isoRange" to mapOf(
            "min" to (isoRange?.lower ?: 100),
            "max" to (isoRange?.upper ?: 11470)
          ),
          "shutterRangeNs" to mapOf(
            "min" to (expRange?.lower ?: 100_000L),
            "max" to (expRange?.upper ?: 16_000_000_000L)
          ),
          "hasOis" to hasOis
        )
      } catch (e: Throwable) {
        Log.e(TAG, "Failed to inspect RAW sensor info: ${e.message}")
        null
      }
    }

    AsyncFunction("captureRawDng") { options: RawCaptureOptionsRecord, promise: Promise ->
      captureRawInternal(options, promise)
    }.runOnQueue(Queues.MAIN)
  }

  @SuppressLint("MissingPermission")
  private fun captureRawInternal(options: RawCaptureOptionsRecord, promise: Promise) {
    val context = appContext.reactContext ?: run {
      promise.reject("ERR_NO_CONTEXT", "React application context unavailable", null)
      return
    }

    val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager ?: run {
      promise.reject("ERR_NO_CAMERA_MGR", "CameraManager service unavailable", null)
      return
    }

    val cameraId = options.cameraId
    val characteristics = try {
      cameraManager.getCameraCharacteristics(cameraId)
    } catch (e: Throwable) {
      promise.reject("ERR_CAMERA_CHARS", "Could not get CameraCharacteristics: ${e.message}", e)
      return
    }

    val caps = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
    if (!caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW)) {
      promise.reject("ERR_RAW_UNSUPPORTED", "Camera $cameraId does not support RAW capture", null)
      return
    }

    val sensorOrientation = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: run {
      promise.reject("ERR_RAW_ORIENTATION", "Camera $cameraId has no sensor orientation", null)
      return
    }
    @Suppress("DEPRECATION")
    val displayRotation = appContext.currentActivity?.windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
    val displayDegrees = when (displayRotation) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
    val sign = if (characteristics.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT) 1 else -1
    // JPEG_ORIENTATION takes degrees; DngCreator takes TIFF/EXIF orientation constants.
    val jpegOrientation = options.orientation ?: (sensorOrientation - displayDegrees * sign + 360) % 360
    val exifOrientation = when (jpegOrientation) {
      0 -> ExifInterface.ORIENTATION_NORMAL
      90 -> ExifInterface.ORIENTATION_ROTATE_90
      180 -> ExifInterface.ORIENTATION_ROTATE_180
      270 -> ExifInterface.ORIENTATION_ROTATE_270
      else -> {
        promise.reject("ERR_RAW_ORIENTATION", "Invalid RAW orientation: $jpegOrientation", null)
        return
      }
    }

    val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
    val rawSizes = map?.getOutputSizes(ImageFormat.RAW_SENSOR) ?: emptyArray()
    val rawSize = rawSizes.firstOrNull() ?: Size(4000, 3000)

    val viewTag = options.viewTag
    var sessionLifecycleRegistry: LifecycleRegistry? = null

    if (viewTag != null && viewTag > 0) {
      val view = appContext.findView<View>(viewTag)
      if (view != null) {
        try {
          val sessionField = view.javaClass.getDeclaredField("cameraSession")
          sessionField.isAccessible = true
          val session = sessionField.get(view)
          if (session is LifecycleOwner) {
            sessionLifecycleRegistry = session.lifecycle as? LifecycleRegistry
          }
        } catch (e: Throwable) {
          Log.w(TAG, "Could not extract cameraSession lifecycle: ${e.message}")
        }
      }
    }

    // Pause VisionCamera's CameraSession so Camera2 can acquire Camera 0
    if (sessionLifecycleRegistry != null) {
      try {
        sessionLifecycleRegistry.currentState = Lifecycle.State.CREATED
        Log.i(TAG, "Paused VisionCamera session lifecycle for pure Camera2 RAW capture")
      } catch (e: Throwable) {
        Log.w(TAG, "Failed to set session lifecycle to CREATED: ${e.message}")
      }
    }

    val bgThread = HandlerThread("CameraRawCaptureThread").apply { start() }
    val bgHandler = Handler(bgThread.looper)
    val mainHandler = Handler(Looper.getMainLooper())

    val settled = AtomicBoolean(false)
    val lock = Any()

    var cameraDevice: CameraDevice? = null
    var captureSession: CameraCaptureSession? = null
    var rawReader: ImageReader? = null
    var jpegReader: ImageReader? = null

    var acquiredRawImage: Image? = null
    var acquiredJpegBytes: ByteArray? = null
    var acquiredTotalResult: TotalCaptureResult? = null

    fun resumeSessionLifecycle() {
      if (sessionLifecycleRegistry != null) {
        mainHandler.post {
          try {
            sessionLifecycleRegistry.currentState = Lifecycle.State.RESUMED
            Log.i(TAG, "Resumed VisionCamera session lifecycle")
          } catch (e: Throwable) {
            Log.w(TAG, "Failed to restore session lifecycle to RESUMED: ${e.message}")
          }
        }
      }
    }

    fun cleanUpResources() {
      synchronized(lock) {
        try { acquiredRawImage?.close() } catch (_: Throwable) {}
        acquiredRawImage = null
        try { captureSession?.close() } catch (_: Throwable) {}
        captureSession = null
        try { cameraDevice?.close() } catch (_: Throwable) {}
        cameraDevice = null
        try { rawReader?.close() } catch (_: Throwable) {}
        rawReader = null
        try { jpegReader?.close() } catch (_: Throwable) {}
        jpegReader = null
        try { bgThread.quitSafely() } catch (_: Throwable) {}
      }
      resumeSessionLifecycle()
    }

    val timeoutRunnable = Runnable {
      if (settled.compareAndSet(false, true)) {
        Log.e(TAG, "RAW capture timed out after ${CAPTURE_TIMEOUT_MS}ms")
        cleanUpResources()
        promise.reject("ERR_RAW_TIMEOUT", "RAW capture timed out after ${CAPTURE_TIMEOUT_MS}ms", null)
      }
    }
    mainHandler.postDelayed(timeoutRunnable, CAPTURE_TIMEOUT_MS)

    fun tryFinalize() {
      bgHandler.post {
        synchronized(lock) {
          if (settled.get()) return@post

          val raw = acquiredRawImage
          val result = acquiredTotalResult
          val needsJpeg = options.includeJpeg
          val jpegBytes = acquiredJpegBytes

          if (raw != null && result != null && (!needsJpeg || jpegBytes != null)) {
            if (settled.compareAndSet(false, true)) {
              mainHandler.removeCallbacks(timeoutRunnable)

              try {
                val timestamp = System.currentTimeMillis()
                val cacheDir = context.cacheDir

                // 1. Write Lossless Adobe DNG
                val dngFile = File(cacheDir, "momints_raw_${timestamp}.dng")
                val dngCreator = DngCreator(characteristics, result)
                dngCreator.setOrientation(exifOrientation)

                FileOutputStream(dngFile).use { fos ->
                  dngCreator.writeImage(fos, raw)
                }
                dngCreator.close()
                raw.close()
                acquiredRawImage = null

                // 2. Write simultaneous hardware JPEG if captured
                var jpegFile: File? = null
                if (jpegBytes != null) {
                  val jFile = File(cacheDir, "momints_frame_${timestamp}.jpg")
                  FileOutputStream(jFile).use { fos ->
                    fos.write(jpegBytes)
                  }
                  jpegFile = jFile
                }

                val dngSize = dngFile.length()
                val jpegSize = jpegFile?.length() ?: 0L

                Log.i(TAG, "Captured RAW DNG (${dngSize / 1024} KB) and JPEG (${jpegSize / 1024} KB)")

                cleanUpResources()

                val resultMap = mutableMapOf<String, Any?>(
                  "dngUri" to "file://${dngFile.absolutePath}",
                  "dngPath" to dngFile.absolutePath,
                  "dngByteLength" to dngSize,
                  "width" to rawSize.width,
                  "height" to rawSize.height,
                  "capturedAt" to timestamp
                )

                if (jpegFile != null) {
                  resultMap["jpegUri"] = "file://${jpegFile.absolutePath}"
                  resultMap["jpegPath"] = jpegFile.absolutePath
                  resultMap["jpegByteLength"] = jpegSize
                }

                promise.resolve(resultMap)
              } catch (e: Throwable) {
                Log.e(TAG, "Error encoding DNG/JPEG: ${e.message}", e)
                cleanUpResources()
                promise.reject("ERR_DNG_WRITE", "Failed to write DNG: ${e.message}", e)
              }
            }
          }
        }
      }
    }

    fun openAndCapture(attempt: Int) {
      try {
        cameraManager.openCamera(cameraId, object : CameraDevice.StateCallback() {
          override fun onOpened(camera: CameraDevice) {
            cameraDevice = camera
            try {
              val rReader = ImageReader.newInstance(rawSize.width, rawSize.height, ImageFormat.RAW_SENSOR, 2)
              rawReader = rReader

              val jReader = if (options.includeJpeg) {
                ImageReader.newInstance(rawSize.width, rawSize.height, ImageFormat.JPEG, 2).also {
                  jpegReader = it
                }
              } else null

              rReader.setOnImageAvailableListener({ reader ->
                synchronized(lock) {
                  if (settled.get()) {
                    try { reader.acquireLatestImage()?.close() } catch (_: Throwable) {}
                    return@synchronized
                  }
                  try {
                    acquiredRawImage = reader.acquireLatestImage()
                  } catch (e: Throwable) {
                    Log.e(TAG, "Failed acquiring raw image: ${e.message}")
                  }
                }
                tryFinalize()
              }, bgHandler)

              jReader?.setOnImageAvailableListener({ reader ->
                synchronized(lock) {
                  if (settled.get()) {
                    try { reader.acquireLatestImage()?.close() } catch (_: Throwable) {}
                    return@synchronized
                  }
                  try {
                    reader.acquireLatestImage()?.use { img ->
                      val buffer = img.planes[0].buffer
                      val bytes = ByteArray(buffer.remaining())
                      buffer.get(bytes)
                      acquiredJpegBytes = bytes
                    }
                  } catch (e: Throwable) {
                    Log.e(TAG, "Failed acquiring jpeg image: ${e.message}")
                  }
                }
                tryFinalize()
              }, bgHandler)

              val surfaces = mutableListOf(rReader.surface)
              if (jReader != null) surfaces.add(jReader.surface)

              @Suppress("DEPRECATION")
              camera.createCaptureSession(surfaces, object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                  captureSession = session
                  try {
                    val requestBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
                      addTarget(rReader.surface)
                      if (jReader != null) addTarget(jReader.surface)

                      // Sensor manual exposure vs auto
                      if (options.manualIso != null || options.manualExposureNs != null) {
                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
                        if (options.manualIso != null) {
                          set(CaptureRequest.SENSOR_SENSITIVITY, options.manualIso)
                        }
                        if (options.manualExposureNs != null) {
                          set(CaptureRequest.SENSOR_EXPOSURE_TIME, options.manualExposureNs)
                        }
                      } else {
                        set(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
                      }

                      // Manual focus vs auto
                      if (options.manualFocusDistance != null) {
                        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
                        set(CaptureRequest.LENS_FOCUS_DISTANCE, options.manualFocusDistance)
                      } else {
                        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                      }

                      // White balance
                      if (options.whiteBalanceMode != null) {
                        set(CaptureRequest.CONTROL_AWB_MODE, options.whiteBalanceMode)
                      }

                      // Optical Image Stabilization (Seeker main sensor supports OIS)
                      val oisModes = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION)
                      if (oisModes?.contains(CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON) == true) {
                        set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE, CameraCharacteristics.LENS_OPTICAL_STABILIZATION_MODE_ON)
                      }

                      // Lens Shading Map mode for DNG vignetting correction
                      set(CaptureRequest.STATISTICS_LENS_SHADING_MAP_MODE, CaptureRequest.STATISTICS_LENS_SHADING_MAP_MODE_ON)

                      set(CaptureRequest.JPEG_ORIENTATION, jpegOrientation)
                    }

                    session.capture(requestBuilder.build(), object : CameraCaptureSession.CaptureCallback() {
                      override fun onCaptureCompleted(
                        session: CameraCaptureSession,
                        request: CaptureRequest,
                        result: TotalCaptureResult
                      ) {
                        synchronized(lock) {
                          acquiredTotalResult = result
                        }
                        tryFinalize()
                      }

                      override fun onCaptureFailed(
                        session: CameraCaptureSession,
                        request: CaptureRequest,
                        failure: android.hardware.camera2.CaptureFailure
                      ) {
                        if (settled.compareAndSet(false, true)) {
                          mainHandler.removeCallbacks(timeoutRunnable)
                          cleanUpResources()
                          promise.reject("ERR_CAPTURE_FAILED", "Camera2 capture failed (reason: ${failure.reason})", null)
                        }
                      }
                    }, bgHandler)

                  } catch (e: Throwable) {
                    if (settled.compareAndSet(false, true)) {
                      mainHandler.removeCallbacks(timeoutRunnable)
                      cleanUpResources()
                      promise.reject("ERR_CAPTURE_REQUEST", "Failed initiating capture: ${e.message}", e)
                    }
                  }
                }

                override fun onConfigureFailed(session: CameraCaptureSession) {
                  if (settled.compareAndSet(false, true)) {
                    mainHandler.removeCallbacks(timeoutRunnable)
                    cleanUpResources()
                    promise.reject("ERR_SESSION_CONFIGURE", "Failed configuring CameraCaptureSession with RAW surface", null)
                  }
                }
              }, bgHandler)

            } catch (e: Throwable) {
              if (settled.compareAndSet(false, true)) {
                mainHandler.removeCallbacks(timeoutRunnable)
                cleanUpResources()
                promise.reject("ERR_SESSION_SETUP", "Failed setting up capture session: ${e.message}", e)
              }
            }
          }

          override fun onDisconnected(camera: CameraDevice) {
            if (settled.compareAndSet(false, true)) {
              mainHandler.removeCallbacks(timeoutRunnable)
              cleanUpResources()
              promise.reject("ERR_CAMERA_DISCONNECTED", "Camera $cameraId disconnected", null)
            }
          }

          override fun onError(camera: CameraDevice, error: Int) {
            // If camera is in use by CameraX teardown race, retry up to 3 times
            if ((error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE ||
                error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE) && attempt < 3) {
              Log.w(TAG, "Camera in use on attempt $attempt, retrying after 60ms...")
              try { camera.close() } catch (_: Throwable) {}
              bgHandler.postDelayed({
                if (!settled.get()) {
                  openAndCapture(attempt + 1)
                }
              }, 60L)
              return
            }

            if (settled.compareAndSet(false, true)) {
              mainHandler.removeCallbacks(timeoutRunnable)
              cleanUpResources()
              promise.reject("ERR_CAMERA_OPEN", "Failed opening camera $cameraId (error code: $error)", null)
            }
          }
        }, bgHandler)
      } catch (e: Throwable) {
        if (settled.compareAndSet(false, true)) {
          mainHandler.removeCallbacks(timeoutRunnable)
          cleanUpResources()
          promise.reject("ERR_CAMERA_OPEN_EX", "Exception opening camera: ${e.message}", e)
        }
      }
    }

    // Small delay (35ms) to give CameraX time to release camera hardware if lifecycle just paused
    val initialDelayMs = if (sessionLifecycleRegistry != null) 40L else 0L
    bgHandler.postDelayed({
      openAndCapture(1)
    }, initialDelayMs)
  }
}

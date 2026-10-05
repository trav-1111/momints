package expo.modules.cameramanual

import android.annotation.SuppressLint
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.MeteringRectangle
import android.view.View
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.camera.camera2.impl.Camera2ImplConfig
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraControl
import androidx.camera.core.impl.CaptureConfig
import androidx.camera.core.impl.Config
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executor
import java.util.concurrent.ExecutionException

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
  @OptIn(ExperimentalCamera2Interop::class)
  override fun definition() = ModuleDefinition {
    Name("CameraManual")

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

    val isIsoManual = state.isoMode == "manual" || (state.exposureMode == "manual" && state.iso != null)
    val isShutterManual = state.shutterMode == "manual" || (state.exposureMode == "manual" && state.shutterNs != null)

    // --- Exposure (ISO / Shutter decoupling & preview clamping) ---
    if (isIsoManual && isShutterManual) {
      // Both manual
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
      state.iso?.let {
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_SENSITIVITY,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_SENSITIVITY,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
      state.shutterNs?.let { ns ->
        // Still capture receives the full requested exposure duration (up to 16s)
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_EXPOSURE_TIME,
          ns,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        val ceiling = maxFrameDuration(camera) ?: ns
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_FRAME_DURATION,
          ns.coerceAtMost(ceiling),
          Config.OptionPriority.ALWAYS_OVERRIDE
        )

        // Repeating preview viewfinder exposure time is clamped to max 100ms (10 FPS)
        // so the screen never freezes or blows out to white
        val previewNs = ns.coerceAtMost(100_000_000L)
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_EXPOSURE_TIME,
          previewNs,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_FRAME_DURATION,
          previewNs,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
    } else if (isIsoManual && !isShutterManual) {
      // ISO Priority (manual ISO, auto shutter)
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
      state.iso?.let {
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_SENSITIVITY,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_SENSITIVITY,
          it,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
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
    } else if (!isIsoManual && isShutterManual) {
      // Shutter Priority (auto ISO, manual shutter)
      state.shutterNs?.let { ns ->
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_MODE,
          CaptureRequest.CONTROL_AE_MODE_OFF,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_EXPOSURE_TIME,
          ns,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        val ceiling = maxFrameDuration(camera) ?: ns
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_FRAME_DURATION,
          ns.coerceAtMost(ceiling),
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        val fallbackIso = state.iso ?: 400
        stillConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_SENSITIVITY,
          fallbackIso,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )

        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.CONTROL_AE_MODE,
          CaptureRequest.CONTROL_AE_MODE_ON,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
        val previewNs = ns.coerceAtMost(100_000_000L)
        previewConfigBuilder.setCaptureRequestOptionWithPriority(
          CaptureRequest.SENSOR_EXPOSURE_TIME,
          previewNs,
          Config.OptionPriority.ALWAYS_OVERRIDE
        )
      }
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
    if (state.meteringMode != "matrix") {
      val array = activeArraySize(camera)
      if (array != null) {
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
      }
    }

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
    val side = (minOf(array.width(), array.height()) * sizeFraction).toInt().coerceAtLeast(1)
    val cx = (array.left + array.width() * centerXFrac).toInt()
    val cy = (array.top + array.height() * centerYFrac).toInt()
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
}


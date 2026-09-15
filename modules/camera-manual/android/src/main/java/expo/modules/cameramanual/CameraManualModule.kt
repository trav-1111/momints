package expo.modules.cameramanual

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.MeteringRectangle
import android.view.View
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

// isoMode/shutterMode/focusMode: "auto" | "manual".
// meteringMode: "matrix" | "center" | "spot".
// awbMode: CameraMetadata.CONTROL_AWB_MODE_* (see index.ts presets).
// A plain Record class instead of ~10 individual Function() params — Expo's
// Function() DSL has an arity ceiling (Function0..FunctionN) that a flat
// 11-parameter lambda exceeds; a single structured JS-object argument sails
// under it and reads better besides.
class CameraStateRecord : Record {
  @Field
  var isoMode: String = "auto"

  @Field
  var iso: Int? = null

  @Field
  var shutterMode: String = "auto"

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
}

// TIER 2 — manual camera controls via CameraX's Camera2Interop, pushed onto
// the LIVE react-native-vision-camera session.
//
// vision-camera's CameraView.cameraSession and CameraSession.camera are
// declared `internal` (Kotlin module-private) — a different Gradle module
// like this one can't reference them with normal syntax. Reflection is the
// deliberate, stable way around that: it reads the backing FIELD by its
// literal name, and Kotlin only mangles cross-module METHOD names, not
// backing fields — so this doesn't depend on guessing a mangled accessor
// name and isn't fragile to compiler-version churn the way that would be.
// No vision-camera fork or patch-package needed. Proven on-device across
// ISO, shutter, white balance, focus, and metering: zero crashes, measured
// effects landing in the actual captured photo, not just the preview.
//
// ARCHITECTURE: applyCameraState rebuilds the ENTIRE desired capture-request
// override set from scratch on every call and uses setCaptureRequestOptions
// (REPLACE), never addCaptureRequestOptions (MERGE). This sidesteps a real
// problem with the merge-based approach: there is no "clear just this one
// key" API on Camera2CameraControl (only clearCaptureRequestOptions(), which
// clears everything). Independent auto/manual toggles for ISO/shutter/focus
// need to be able to release JUST one control back to auto while others stay
// manual — only achievable by owning the full state and replacing it
// wholesale each time, which is exactly what the JS layer already does
// (it holds all UI state and calls this after every change anyway).
class CameraManualModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CameraManual")

    // The four isoMode x shutterMode combinations map to Camera2's real
    // exposure states:
    //   auto/auto     -> AE_MODE_ON, no priority mode, no manual overrides
    //   manual/auto   -> AE_MODE_ON + AE_PRIORITY_MODE_SENSOR_SENSITIVITY_PRIORITY
    //   auto/manual   -> AE_MODE_ON + AE_PRIORITY_MODE_SENSOR_EXPOSURE_TIME_PRIORITY
    //   manual/manual -> AE_MODE_OFF (full manual, both sensor keys set)
    // The two priority-mode states require CONTROL_AE_AVAILABLE_PRIORITY_MODES
    // to actually include that mode (see camera-caps) — the JS layer checks
    // this and falls back to a paired auto/manual toggle when unsupported,
    // so this function trusts its caller rather than re-validating.
    Function("applyCameraState") { viewTag: Int, state: CameraStateRecord ->
      applyCameraState(viewTag, state)
    }

    // Full escape hatch — clears every override in one call, distinct from
    // applyCameraState(all auto) in that it doesn't require knowing/computing
    // a valid full state first. Useful on screen unmount/cleanup.
    Function("resetToAuto") { viewTag: Int ->
      resetAuto(viewTag)
    }
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun applyCameraState(viewTag: Int, state: CameraStateRecord) {
    val camera = resolveCameraXCamera(viewTag)
      ?: throw CodedException(
        "ERR_CAMERA_NOT_BOUND",
        "No bound CameraX session on view $viewTag yet — try again once the preview is visible",
        null,
      )

    val builder = CaptureRequestOptions.Builder()

    // --- Exposure (ISO / shutter) ---
    val isoManual = state.isoMode == "manual"
    val shutterManual = state.shutterMode == "manual"
    when {
      isoManual && shutterManual -> {
        builder.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
        state.iso?.let { builder.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, it) }
        state.shutterNs?.let { builder.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, it) }
      }
      isoManual && !shutterManual -> {
        builder.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
        builder.setCaptureRequestOption(
          CaptureRequest.CONTROL_AE_PRIORITY_MODE,
          CaptureRequest.CONTROL_AE_PRIORITY_MODE_SENSOR_SENSITIVITY_PRIORITY,
        )
        state.iso?.let { builder.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, it) }
      }
      !isoManual && shutterManual -> {
        builder.setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_ON)
        builder.setCaptureRequestOption(
          CaptureRequest.CONTROL_AE_PRIORITY_MODE,
          CaptureRequest.CONTROL_AE_PRIORITY_MODE_SENSOR_EXPOSURE_TIME_PRIORITY,
        )
        state.shutterNs?.let { builder.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, it) }
      }
      else -> {
        // Both auto: omit AE_MODE/AE_PRIORITY_MODE/sensor keys entirely so
        // CameraX's own default (fully auto) applies — nothing to override.
      }
    }

    // --- Focus ---
    if (state.focusMode == "manual") {
      builder.setCaptureRequestOption(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_OFF)
      state.focusDistance?.let { builder.setCaptureRequestOption(CaptureRequest.LENS_FOCUS_DISTANCE, it) }
    }
    // else: omit AF_MODE/LENS_FOCUS_DISTANCE — CameraX's own continuous-AF default applies.

    // --- White balance (always has a value; AUTO=1 is a real preset, not "unset") ---
    builder.setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, state.awbMode)

    // --- Metering (only meaningful while AE_MODE isn't OFF, harmless otherwise) ---
    if (state.meteringMode != "matrix") {
      val array = activeArraySize(camera)
      if (array != null) {
        val region = when (state.meteringMode) {
          "center" -> centeredRegion(array, 0.5f, 0.5f, 0.5f)
          "spot" -> centeredRegion(array, state.meteringNormX, state.meteringNormY, 0.12f)
          else -> null
        }
        if (region != null) {
          builder.setCaptureRequestOption(CaptureRequest.CONTROL_AE_REGIONS, arrayOf(region))
        }
      }
    }
    // "matrix": omit CONTROL_AE_REGIONS — device default is whole-frame metering.

    Camera2CameraControl.from(camera.cameraControl).setCaptureRequestOptions(builder.build())
  }

  // A square region of `sizeFraction` of the active array's shorter side,
  // centered at (centerXFrac, centerYFrac) in 0..1 normalized coordinates,
  // clamped so it never runs off the sensor's real pixel bounds.
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
  private fun resetAuto(viewTag: Int) {
    val camera = resolveCameraXCamera(viewTag) ?: return
    Camera2CameraControl.from(camera.cameraControl).clearCaptureRequestOptions()
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
}

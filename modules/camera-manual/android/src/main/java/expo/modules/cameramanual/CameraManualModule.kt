package expo.modules.cameramanual

import android.hardware.camera2.CaptureRequest
import android.view.View
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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
// No vision-camera fork or patch-package needed. Proven on-device (Day-1
// gate): repeated ISO changes via this exact path, zero crashes, measured
// brightness swing matching the requested gain.
//
// IMPORTANT: Camera2CameraControl.setCaptureRequestOptions() REPLACES the
// entire override set — confirmed by reading the real CameraX AAR (it has a
// separate addCaptureRequestOptions() specifically for merging). Exposure
// and white balance are independent 3A controls that both need to be live
// at once, so every incremental call here uses `add`, never `set`. Only the
// full reset clears everything in one shot.
class CameraManualModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CameraManual")

    // iso/shutterNs null-safe: pass only the one(s) you want to change.
    // Forces CONTROL_AE_MODE off — manual ISO/shutter are ignored by the
    // sensor otherwise, since the auto-exposure algorithm keeps overwriting
    // them every frame.
    Function("applyManualExposure") { viewTag: Int, iso: Int?, shutterNs: Long? ->
      applyManualExposure(viewTag, iso, shutterNs)
    }

    // awbMode: one of CameraMetadata.CONTROL_AWB_MODE_* (see index.ts for
    // the named preset map). Independent of exposure — does not touch
    // CONTROL_AE_MODE, so this can be called with exposure left on auto.
    Function("applyWhiteBalance") { viewTag: Int, awbMode: Int ->
      applyWhiteBalance(viewTag, awbMode)
    }

    // Clears every override (AE, AWB, everything) — hands the whole session
    // back to CameraX's normal auto-everything behavior in one call.
    Function("resetToAuto") { viewTag: Int ->
      resetAuto(viewTag)
    }
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun applyManualExposure(viewTag: Int, iso: Int?, shutterNs: Long?) {
    val control = requireCamera2Control(viewTag)
    val builder = CaptureRequestOptions.Builder()
      .setCaptureRequestOption(CaptureRequest.CONTROL_AE_MODE, CaptureRequest.CONTROL_AE_MODE_OFF)
    if (iso != null) {
      builder.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso)
    }
    if (shutterNs != null) {
      builder.setCaptureRequestOption(CaptureRequest.SENSOR_EXPOSURE_TIME, shutterNs)
    }
    control.addCaptureRequestOptions(builder.build())
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun applyWhiteBalance(viewTag: Int, awbMode: Int) {
    val control = requireCamera2Control(viewTag)
    val builder = CaptureRequestOptions.Builder()
      .setCaptureRequestOption(CaptureRequest.CONTROL_AWB_MODE, awbMode)
    control.addCaptureRequestOptions(builder.build())
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun resetAuto(viewTag: Int) {
    val camera = resolveCameraXCamera(viewTag) ?: return
    Camera2CameraControl.from(camera.cameraControl).clearCaptureRequestOptions()
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun requireCamera2Control(viewTag: Int): Camera2CameraControl {
    val camera = resolveCameraXCamera(viewTag)
      ?: throw CodedException(
        "ERR_CAMERA_NOT_BOUND",
        "No bound CameraX session on view $viewTag yet — try again once the preview is visible",
        null,
      )
    return Camera2CameraControl.from(camera.cameraControl)
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

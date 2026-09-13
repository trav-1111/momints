package expo.modules.cameracaps

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import org.json.JSONArray
import org.json.JSONObject
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// SPIKE ONLY. Reads android.hardware.camera2.CameraCharacteristics for every
// camera on the device — the same characteristics info any third-party app
// can query (no privileged/vendor API, no camera session opened, no runtime
// permission needed to just read these). Answers: does Camera2 report
// MANUAL_SENSOR / MANUAL_POST_PROCESSING / RAW as available, and what are the
// real ISO / exposure-time / focus / AWB ranges on this specific device.
class CameraCapsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CameraCaps")

    Function("getCameraCapabilitiesJson") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No React context available")
      val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
      val cameras = JSONArray()

      for (id in manager.cameraIdList) {
        val chars = manager.getCameraCharacteristics(id)

        val capsInts = chars.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
        val capNames = JSONArray()
        capsInts.forEach { capNames.put(capabilityName(it)) }

        val isoRange = chars.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
        val expRange = chars.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
        val minFocusDistance = chars.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE)
        val afModes = chars.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: IntArray(0)
        val awbModes = chars.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES) ?: IntArray(0)
        val hasAfModeOff = afModes.contains(CameraCharacteristics.CONTROL_AF_MODE_OFF)
        val hasAwbModeOff = awbModes.contains(CameraCharacteristics.CONTROL_AWB_MODE_OFF)
        // A lens with minFocusDistance == 0 is fixed-focus (per Android docs) — no
        // amount of AF_MODE_OFF + LENS_FOCUS_DISTANCE will move it.
        val manualFocusPossible = (minFocusDistance != null && minFocusDistance > 0f) && hasAfModeOff

        val entry = JSONObject()
        entry.put("cameraId", id)
        entry.put("lensFacing", lensFacingName(chars.get(CameraCharacteristics.LENS_FACING)))
        entry.put(
          "hardwareLevel",
          hardwareLevelName(chars.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)),
        )
        entry.put("availableCapabilities", capNames)
        entry.put(
          "hasManualSensor",
          capsInts.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR),
        )
        entry.put(
          "hasManualPostProcessing",
          capsInts.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING),
        )
        entry.put("hasRaw", capsInts.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW))
        entry.put("isoMin", isoRange?.lower)
        entry.put("isoMax", isoRange?.upper)
        entry.put("exposureTimeNsMin", expRange?.lower)
        entry.put("exposureTimeNsMax", expRange?.upper)
        entry.put("minFocusDistanceDiopters", minFocusDistance)
        entry.put("manualFocusPossible", manualFocusPossible)
        entry.put("hasAfModeOff", hasAfModeOff)
        entry.put("hasAwbModeOff", hasAwbModeOff)
        cameras.put(entry)
      }

      return@Function cameras.toString()
    }
  }

  private fun capabilityName(value: Int): String = when (value) {
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_BACKWARD_COMPATIBLE -> "BACKWARD_COMPATIBLE"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR -> "MANUAL_SENSOR"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING -> "MANUAL_POST_PROCESSING"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_RAW -> "RAW"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_PRIVATE_REPROCESSING -> "PRIVATE_REPROCESSING"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_READ_SENSOR_SETTINGS -> "READ_SENSOR_SETTINGS"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_BURST_CAPTURE -> "BURST_CAPTURE"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_YUV_REPROCESSING -> "YUV_REPROCESSING"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT -> "DEPTH_OUTPUT"
    CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_CONSTRAINED_HIGH_SPEED_VIDEO -> "CONSTRAINED_HIGH_SPEED_VIDEO"
    11 -> "MOTION_TRACKING"
    12 -> "LOGICAL_MULTI_CAMERA"
    13 -> "MONOCHROME"
    14 -> "SECURE_IMAGE_DATA"
    15 -> "SYSTEM_CAMERA"
    16 -> "OFFLINE_PROCESSING"
    17 -> "ULTRA_HIGH_RESOLUTION_SENSOR"
    18 -> "REMOSAIC_REPROCESSING"
    19 -> "COLOR_SPACE_PROFILES"
    20 -> "STREAM_USE_CASE"
    21 -> "DYNAMIC_RANGE_TEN_BIT"
    22 -> "STREAM_CONFIGURATION_TABLE"
    23 -> "PREVIEW_STABILIZATION"
    else -> "UNKNOWN($value)"
  }

  private fun lensFacingName(value: Int?): String = when (value) {
    CameraCharacteristics.LENS_FACING_FRONT -> "FRONT"
    CameraCharacteristics.LENS_FACING_BACK -> "BACK"
    CameraCharacteristics.LENS_FACING_EXTERNAL -> "EXTERNAL"
    else -> "UNKNOWN"
  }

  private fun hardwareLevelName(value: Int?): String = when (value) {
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
    CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_EXTERNAL -> "EXTERNAL"
    else -> "UNKNOWN"
  }
}

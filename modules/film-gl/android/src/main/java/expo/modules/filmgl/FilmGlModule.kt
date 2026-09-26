package expo.modules.filmgl

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FilmGlOptionsRecord : Record {
  @Field var inputUri: String = ""
  @Field var outputUri: String = ""
  @Field var aspect: String? = null
  @Field var lutUri: String? = null
  @Field var grainIntensity: Float = 0f
  @Field var grainSize: Float = 1f
  @Field var grainSeed: Float = 0f
  @Field var halationIntensity: Float = 0f
  @Field var halationRadius: Float = 0f
  @Field var hasLut: Boolean = false
  @Field var isBW: Boolean = false
  @Field var originX: Int = 0
  @Field var originY: Int = 0
  @Field var cropWidth: Int = 0
  @Field var cropHeight: Int = 0
  @Field var jpegQuality: Int = 90
}

class FilmGlModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FilmGl")

    AsyncFunction("applyFilmNative") { options: FilmGlOptionsRecord ->
      val context = appContext.reactContext ?: throw IllegalStateException("ReactContext is null")
      val renderer = FilmRenderer(context)
      renderer.render(options)
    }
  }
}

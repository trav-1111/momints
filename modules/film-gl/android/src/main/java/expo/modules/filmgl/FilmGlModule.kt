package expo.modules.filmgl

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FilmGlOptionsRecord : Record {
  @Field var inputUri: String = ""
  @Field var outputUri: String = ""
  @Field var filmStockId: String = ""
  @Field var recipeJson: String = ""
  @Field var recipeSha256: String = ""
  @Field var lutUri: String? = null
  @Field var seed: Float = 0f
  @Field var jpegQuality: Int = 95
}

class FilmGlModule : Module() {
  private val renderLock = Any()
  override fun definition() = ModuleDefinition {
    Name("FilmGl")
    AsyncFunction("applyFilmNative") { options: FilmGlOptionsRecord ->
      val context = appContext.reactContext ?: error("ReactContext is null")
      synchronized(renderLock) { FilmRenderer(context).render(options) }
    }
  }
}

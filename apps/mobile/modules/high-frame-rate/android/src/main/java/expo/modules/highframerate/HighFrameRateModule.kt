package expo.modules.highframerate

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HighFrameRateModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HighFrameRate")

    View(HighFrameRateView::class) {
      Prop("enabled") { view: HighFrameRateView, enabled: Boolean ->
        view.requestHigh = enabled
      }
    }
  }
}

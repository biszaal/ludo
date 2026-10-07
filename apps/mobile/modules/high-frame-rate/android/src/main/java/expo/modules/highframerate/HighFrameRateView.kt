package expo.modules.highframerate

import android.content.Context
import android.os.Build
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Asks Android for its HIGH frame-rate category whenever the Skia canvas inside
 * this view draws a new frame.
 *
 * Android 15 and later render an app at whatever rate its views vote for, and a
 * view with no opinion votes NORMAL — 60Hz on a Galaxy S26 Ultra. A touch
 * boosts the app to 120 for a moment, which is why a player's own roll was
 * smooth; nothing boosts an opponent's roll or move, so those ran at 60. A
 * TextureView (which is what a Skia canvas draws into) makes it worse: once
 * its frames arrive more than 15ms apart it votes NORMAL on purpose
 * (TextureView.calculateFrameRateCategory), so a canvas animating at 60 keeps
 * the app at 60.
 *
 * An explicit request replaces that heuristic, and it only counts on frames in
 * which the view is actually redrawn — a canvas at rest asks for nothing, so
 * this costs nothing between animations.
 *
 * Children are marked as they are added; Skia's view builds its TextureView in
 * its own constructor, so it is already in place by then.
 */
class HighFrameRateView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  /** Not `enabled`: that is View.setEnabled, which this must not override. */
  var requestHigh: Boolean = true
    set(value) {
      field = value
      mark(this)
    }

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    mark(child)
  }

  private fun mark(view: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) return
    if (view is TextureView) {
      view.requestedFrameRate =
        if (requestHigh) View.REQUESTED_FRAME_RATE_CATEGORY_HIGH else View.REQUESTED_FRAME_RATE_CATEGORY_DEFAULT
    }
    if (view is ViewGroup) {
      for (i in 0 until view.childCount) mark(view.getChildAt(i))
    }
  }
}

/**
 * Wrap a Skia canvas whose motion should render at the display's full rate on
 * Android's adaptive refresh (see android/…/HighFrameRateView.kt for why it
 * otherwise runs at 60Hz). Everywhere else this is a plain View.
 *
 * The native half only exists in builds made after it was added. An OTA of
 * this JavaScript can still land on an older binary, so the native view is
 * looked up optionally: on a build without it — and on iOS, where the module
 * is not built — the wrapper falls back to a View and changes nothing.
 */

import type { ComponentType } from "react";
import { View, type ViewProps } from "react-native";
import { requireNativeView, requireOptionalNativeModule } from "expo";

export interface HighFrameRateProps extends ViewProps {
  /** Ask for the high frame-rate category. False leaves the choice to Android. */
  enabled?: boolean;
}

const NativeHighFrameRate: ComponentType<HighFrameRateProps> | null = requireOptionalNativeModule("HighFrameRate")
  ? requireNativeView<HighFrameRateProps>("HighFrameRate")
  : null;

export function HighFrameRate({ enabled = true, ...rest }: HighFrameRateProps) {
  return NativeHighFrameRate ? <NativeHighFrameRate enabled={enabled} {...rest} /> : <View {...rest} />;
}

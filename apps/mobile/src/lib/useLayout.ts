/**
 * The live responsive context: turns the window size + safe-area insets into
 * the tier and the derived values components actually consume. Thin wrapper
 * over the pure helpers in layout.ts (kept separate so those stay Node-testable
 * without pulling in react-native).
 */

import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import { contentMaxWidth, contentPadding, layoutTier, uiScale, type LayoutTier } from "./layout";

export interface Layout {
  tier: LayoutTier;
  isTablet: boolean;
  /** Centered-column cap; undefined on phone (no cap). */
  maxWidth: number | undefined;
  /** Art / display-type multiplier: 1 on phone, ~1.3 on tablet. */
  scale: number;
  /** Horizontal page padding for this tier. */
  pad: number;
  width: number;
  height: number;
  insets: EdgeInsets;
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(() => {
    const tier = layoutTier(width, height);
    return {
      tier,
      isTablet: tier === "tablet",
      maxWidth: contentMaxWidth(tier),
      scale: uiScale(tier),
      pad: contentPadding(tier),
      width,
      height,
      insets,
    };
  }, [width, height, insets]);
}

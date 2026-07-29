/**
 * Responsive tier thresholds. The min-dimension rule is what makes a narrow
 * iPad split-view pane fall back to phone, and keeps the tier stable across
 * orientation — pin both.
 */

import { describe, expect, it } from "vitest";
import {
  contentMaxWidth,
  contentPadding,
  layoutTier,
  TABLET_MIN_SHORT_SIDE,
  uiScale,
} from "../src/lib/layout";

describe("layoutTier", () => {
  it("reads phones as phone in portrait and landscape", () => {
    expect(layoutTier(375, 667)).toBe("phone"); // iPhone SE
    expect(layoutTier(375, 812)).toBe("phone"); // 12 mini
    expect(layoutTier(430, 932)).toBe("phone"); // 15 Pro Max
    expect(layoutTier(932, 430)).toBe("phone"); // …rotated
  });

  it("reads iPads as tablet in both orientations", () => {
    expect(layoutTier(768, 1024)).toBe("tablet");
    expect(layoutTier(1024, 768)).toBe("tablet");
    expect(layoutTier(1024, 1366)).toBe("tablet"); // 12.9"
  });

  it("falls back to phone for a narrow split-view pane", () => {
    expect(layoutTier(400, 1024)).toBe("phone"); // slide-over on iPad
  });

  it("switches exactly at the short-side threshold", () => {
    expect(layoutTier(TABLET_MIN_SHORT_SIDE, 1000)).toBe("tablet");
    expect(layoutTier(TABLET_MIN_SHORT_SIDE - 1, 1000)).toBe("phone");
  });
});

describe("derived values", () => {
  it("caps content on tablet, leaves phone uncapped (a style no-op)", () => {
    expect(contentMaxWidth("phone")).toBeUndefined();
    expect(contentMaxWidth("tablet")).toBe(600);
  });

  it("scales up only on tablet", () => {
    expect(uiScale("phone")).toBe(1);
    expect(uiScale("tablet")).toBeGreaterThan(1);
  });

  it("pads wider on tablet", () => {
    expect(contentPadding("tablet")).toBeGreaterThan(contentPadding("phone"));
  });
});

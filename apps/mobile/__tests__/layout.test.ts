/**
 * Responsive tier thresholds. The min-dimension rule is what makes a narrow
 * iPad split-view pane fall back to phone, and keeps the tier stable across
 * orientation — pin both.
 */

import { describe, expect, it } from "vitest";
import {
  contentMaxWidth,
  contentPadding,
  GAME_COLUMN_MAX,
  gameColumnWidth,
  gameShape,
  layoutTier,
  railedBoardSize,
  stackedBoardSize,
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

describe("gameShape", () => {
  it("stacks in portrait and rails in landscape, on both tiers", () => {
    expect(gameShape(430, 932)).toBe("stacked"); // 15 Pro Max
    expect(gameShape(932, 430)).toBe("railed"); // …rotated
    expect(gameShape(1024, 1366)).toBe("stacked"); // iPad
    expect(gameShape(1366, 1024)).toBe("railed");
  });

  it("treats an exactly square window as stacked", () => {
    expect(gameShape(800, 800)).toBe("stacked");
  });
});

describe("gameColumnWidth", () => {
  it("shares the app-wide reading column in portrait", () => {
    expect(gameColumnWidth("stacked", "tablet", 1024)).toBe(contentMaxWidth("tablet"));
    expect(gameColumnWidth("stacked", "phone", 430)).toBe(430);
  });

  it("takes the window in landscape — the 600pt cap would starve the rail", () => {
    expect(gameColumnWidth("railed", "tablet", 1366)).toBe(1366); // 12.9" iPad
    expect(gameColumnWidth("railed", "phone", 814)).toBe(814);
  });

  it("stops a desktop-class freeform window from sprawling", () => {
    expect(gameColumnWidth("railed", "tablet", 2400)).toBe(GAME_COLUMN_MAX);
  });
});

describe("board sizing", () => {
  it("leaves portrait phones exactly as they were", () => {
    // The pre-landscape formula: min(width − 48, height × 0.44).
    expect(stackedBoardSize(430, 932, "phone")).toBe(Math.floor(Math.min(430 - 48, 932 * 0.44)));
  });

  it("gives portrait tablets the taller slice once height is the binding cap", () => {
    // At 600×1366 both tiers are width-bound at 552 and the fractions never
    // show; a shorter window is what separates 0.5 from 0.44.
    expect(stackedBoardSize(600, 1000, "tablet")).toBe(500);
    expect(stackedBoardSize(600, 1000, "phone")).toBe(440);
  });

  it("keeps a rotated phone within a few points of its portrait board", () => {
    // iPhone 15 Pro Max: 430×932 upright, 932×430 rotated with ~59pt notch
    // insets each side and a 24pt page pad, ~40pt of top bar out of the height.
    const portrait = stackedBoardSize(430, 932, "phone");
    const landscape = railedBoardSize(932 - 59 * 2, 430 - 21 - 40);
    expect(landscape).toBeGreaterThan(portrait * 0.9);
  });

  it("is height-bound when the window is short and width-bound when narrow", () => {
    expect(railedBoardSize(1200, 400)).toBe(400);
    expect(railedBoardSize(700, 900)).toBe(700 - 48 - 92 * 2 - 176 - 36);
  });

  it("never returns a negative side on an absurdly narrow window", () => {
    expect(railedBoardSize(200, 300)).toBe(0);
  });
});

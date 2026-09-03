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
  HERO_MAX,
  HERO_MIN,
  homeFurniture,
  homeMetrics,
  HOME_GUEST_STRIP,
  HOME_NATURAL,
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

describe("homeMetrics", () => {
  // Column heights: the window minus safe-area insets minus the ad strip.
  const columns: Array<[string, number, number]> = [
    ["iPhone SE (1st gen)", 568 - 20 - 50, 1],
    ["iPhone SE (3rd gen)", 667 - 20 - 50, 1],
    ["iPhone 13 mini", 812 - 50 - 34 - 50, 1],
    ["iPhone 15 Pro", 852 - 59 - 34 - 50, 1],
    ["iPhone 15 Pro Max", 932 - 62 - 34 - 50, 1],
    ["phone, landscape", 430 - 21 - 50, 1],
    ["iPad 10.9", 1180 - 24 - 20 - 50, 1.3],
    ["iPad Pro 12.9", 1366 - 24 - 20 - 50, 1.3],
  ];

  it.each(columns)("fits the whole tower inside %s without scrolling", (_name, column, scale) => {
    const m = homeMetrics(column, scale);
    expect(homeFurniture(m) + m.hero).toBeLessThanOrEqual(column);
  });

  it.each(columns)("keeps every tap target comfortable on %s", (_name, column, scale) => {
    const m = homeMetrics(column, scale);
    expect(m.cta).toBeGreaterThanOrEqual(44);
    expect(m.dock).toBeGreaterThanOrEqual(44);
    expect(m.tile).toBeGreaterThanOrEqual(44);
    expect(m.chest).toBeGreaterThanOrEqual(32);
  });

  it.each(columns)("leaves the still-life something to draw on %s", (_name, column, scale) => {
    expect(homeMetrics(column, scale).hero).toBeGreaterThan(80);
  });

  it("leaves a roomy phone at natural size", () => {
    const m = homeMetrics(667 - 20 - 50, 1);
    expect(m.tile).toBe(HOME_NATURAL.tile);
    expect(m.dock).toBe(HOME_NATURAL.dock);
    expect(m.presence).toBe(HOME_NATURAL.presence);
  });

  it("drops the friends line before it shrinks anything tappable", () => {
    // Just short of natural: the 18pt line is exactly what has to give.
    const natural = homeFurniture(homeMetrics(667 - 20 - 50, 1));
    const m = homeMetrics(natural + HERO_MIN - 10, 1);
    expect(m.presence).toBe(0);
    expect(m.tile).toBe(HOME_NATURAL.tile);
    expect(m.dock).toBe(HOME_NATURAL.dock);
  });

  it("compresses the furniture once dropping the line is not enough", () => {
    const m = homeMetrics(568 - 20 - 50, 1);
    expect(m.presence).toBe(0);
    expect(m.tile).toBeLessThan(HOME_NATURAL.tile);
    expect(m.dock).toBeLessThan(HOME_NATURAL.dock);
    expect(m.hero).toBeGreaterThanOrEqual(HERO_MIN - 1);
  });

  it("grows the furniture on a tall screen instead of stranding felt", () => {
    const tall = 932 - 62 - 34;
    const m = homeMetrics(tall, 1);
    expect(m.tile).toBeGreaterThan(HOME_NATURAL.tile);
    expect(m.dock).toBeGreaterThan(HOME_NATURAL.dock);
    // Growth is capped, so the still-life can still exceed HERO_MAX on the
    // tallest phones — but it must have given some of that felt back.
    expect(m.hero).toBeLessThan(tall - homeFurniture(homeMetrics(667 - 20 - 50, 1)));
  });

  it("shrinks monotonically as the column shrinks", () => {
    let previous = Infinity;
    for (let column = 900; column >= 320; column -= 10) {
      const total = homeFurniture(homeMetrics(column, 1));
      expect(total).toBeLessThanOrEqual(previous + 1);
      previous = total;
    }
  });

  it("pays for the guest strip out of the felt, not the doorways", () => {
    const column = 667 - 20 - 50; // an SE-sized hub column
    const bare = homeMetrics(column, 1);
    const strip = homeMetrics(column - HOME_GUEST_STRIP, 1);

    // The strip is what used to float over the dock, so the dock is the one
    // thing that must not pay for it. The still-life and the friends line do.
    expect(strip.dock).toBe(bare.dock);
    expect(strip.tile).toBe(bare.tile);
    expect(strip.hero).toBeLessThan(bare.hero);

    // And the whole tower still fits with the strip's block set aside.
    expect(homeFurniture(strip) + strip.hero + HOME_GUEST_STRIP).toBeLessThanOrEqual(column);
  });

  it("falls back to natural size before the column has been measured", () => {
    expect(homeMetrics(0, 1).tile).toBe(HOME_NATURAL.tile);
    expect(homeMetrics(Number.NaN, 1).tile).toBe(HOME_NATURAL.tile);
  });
});

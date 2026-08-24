/**
 * Whether the Shop's gem strip is worth drawing at all.
 *
 * The strip promotes two ways to get gems: packs and a rewarded ad. Either can
 * be switched off independently — `purchasesEnabled` is the billing flag, and
 * the ad row has its own kill switch (gemAdRow) — so the strip has to survive
 * every combination without leaving a labelled section header above an empty
 * row, which is the specific ugliness this prevents.
 *
 * The rule: draw the strip when at least one way in is live. Never draw a
 * heading over nothing.
 */

import { describe, expect, it } from "vitest";
import { gemStripView } from "../src/lib/gemStrip";

describe("gemStripView", () => {
  it("shows both ways in when both are live", () => {
    const v = gemStripView({ tierOn: true, packsBuyable: true, adVisible: true });
    expect(v).toEqual({ visible: true, showPacks: true, showAd: true });
  });

  it("shows only the ad when packs cannot be bought", () => {
    // Pre-billing builds, or a store that never configured: the ad is still a
    // real way to get gems and should not be hidden with the packs.
    const v = gemStripView({ tierOn: true, packsBuyable: false, adVisible: true });
    expect(v).toEqual({ visible: true, showPacks: false, showAd: true });
  });

  it("shows only the packs when the ad placement is off", () => {
    const v = gemStripView({ tierOn: true, packsBuyable: true, adVisible: false });
    expect(v).toEqual({ visible: true, showPacks: true, showAd: false });
  });

  it("draws nothing when neither way in is live", () => {
    // The case that would otherwise leave a "GET GEMS" heading over blank space.
    const v = gemStripView({ tierOn: true, packsBuyable: false, adVisible: false });
    expect(v.visible).toBe(false);
  });

  it("draws nothing when the whole premium tier is off", () => {
    // gems.enabled false means the currency does not exist for this player;
    // no amount of live sub-placements should put it back on screen.
    const v = gemStripView({ tierOn: false, packsBuyable: true, adVisible: true });
    expect(v.visible).toBe(false);
    expect(v.showPacks).toBe(false);
    expect(v.showAd).toBe(false);
  });
});

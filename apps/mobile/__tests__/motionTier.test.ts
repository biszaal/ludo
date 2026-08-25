/**
 * Motion tier thresholds — which phones get the full animation budget.
 *
 * The rule that matters most is the one about unknowns: a device we cannot
 * measure must get the GOOD experience, not the degraded one. Getting that
 * backwards would quietly downgrade every platform where `expo-device` returns
 * null, which is most of them outside Android.
 */

import { describe, expect, it } from "vitest";
import { LOW_DEVICE_YEAR, LOW_MEMORY_BYTES, motionTier, type MotionSignals } from "../src/lib/motionTier";

/** A capable, modern phone with no accessibility preference set. */
const CAPABLE: MotionSignals = {
  totalMemoryBytes: 8 * 1024 ** 3,
  deviceYear: 2024,
  osReduceMotion: false,
  override: "auto",
};

describe("motionTier on auto", () => {
  it("gives a capable device the full budget", () => {
    expect(motionTier(CAPABLE)).toBe("full");
  });

  it("reduces when the OS accessibility setting asks for less motion", () => {
    expect(motionTier({ ...CAPABLE, osReduceMotion: true })).toBe("reduced");
  });

  it("reduces on a low-memory device", () => {
    expect(motionTier({ ...CAPABLE, totalMemoryBytes: LOW_MEMORY_BYTES - 1 })).toBe("reduced");
    expect(motionTier({ ...CAPABLE, totalMemoryBytes: LOW_MEMORY_BYTES })).toBe("full");
  });

  it("reduces on an old device year class", () => {
    expect(motionTier({ ...CAPABLE, deviceYear: LOW_DEVICE_YEAR - 1 })).toBe("reduced");
    expect(motionTier({ ...CAPABLE, deviceYear: LOW_DEVICE_YEAR })).toBe("full");
  });

  it("treats unmeasurable devices as capable, never as slow", () => {
    // iOS reports neither of these. Reading null as "low" would downgrade
    // every iPhone in the fleet.
    expect(motionTier({ ...CAPABLE, totalMemoryBytes: null, deviceYear: null })).toBe("full");
  });

  it("reduces when any one signal says so, not only when all of them do", () => {
    expect(motionTier({ ...CAPABLE, totalMemoryBytes: null, deviceYear: 2015 })).toBe("reduced");
  });
});

describe("motionTier overrides", () => {
  it("honours an explicit request for less motion on a capable device", () => {
    expect(motionTier({ ...CAPABLE, override: "reduced" })).toBe("reduced");
  });

  it("honours an explicit request for full motion on a weak device", () => {
    expect(
      motionTier({ totalMemoryBytes: 1 * 1024 ** 3, deviceYear: 2014, osReduceMotion: false, override: "full" }),
    ).toBe("full");
  });

  it("lets an explicit request for full motion beat the OS setting", () => {
    // Deliberate: the OS switch is a system-wide default, but a player who
    // opened OUR settings and asked for animation has made a specific,
    // informed choice about this app. It is theirs to make.
    expect(motionTier({ ...CAPABLE, osReduceMotion: true, override: "full" })).toBe("full");
  });
});

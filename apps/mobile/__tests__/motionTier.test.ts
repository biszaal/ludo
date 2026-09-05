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

/**
 * A capable, modern phone with no accessibility preference set.
 *
 * `deviceYear` is 2014 rather than a present-day year on purpose: 2014 is the
 * highest score device-year-class can emit, so this is what a current flagship
 * actually reports. A fixture using a year the value cannot reach is what let
 * an impossible threshold pass its own tests.
 */
const CAPABLE: MotionSignals = {
  totalMemoryBytes: 8 * 1024 ** 3,
  deviceYear: 2014,
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
    expect(motionTier({ ...CAPABLE, totalMemoryBytes: null, deviceYear: 2012 })).toBe("reduced");
  });
});

/**
 * `deviceYear` does not mean "the year this phone came out". It is Facebook's
 * device-year-class score, and that library stopped being updated in 2015: its
 * three probes are capped at 2012 (cores), 2014 (clock) and 2014 (RAM), and the
 * score is their median. 2014 is therefore the CEILING — the score a brand-new
 * flagship reports, not the score of a phone from 2014.
 *
 * A threshold above that ceiling is not a strict threshold, it is an always-true
 * one, and it silently put the entire Android fleet on the reduced tier while
 * every iPhone (null, unmeasurable) stayed on full. These tests pin the ceiling
 * so the threshold can never drift back out of the range the value can occupy.
 */
describe("motionTier against the real device-year-class range", () => {
  /** The best score the library can emit: median of [2012 cores, 2014 clock, 2014 RAM]. */
  const YEAR_CLASS_CEILING = 2014;
  /** device-year-class says "I could not measure this" with -1, not with null. */
  const YEAR_CLASS_UNKNOWN = -1;

  it("keeps the threshold inside the range the score can actually reach", () => {
    expect(LOW_DEVICE_YEAR).toBeLessThanOrEqual(YEAR_CLASS_CEILING);
  });

  it("gives a modern Android flagship the full budget", () => {
    expect(motionTier({ ...CAPABLE, deviceYear: YEAR_CLASS_CEILING })).toBe("full");
  });

  it("reads an unmeasurable Android device as capable, not as ancient", () => {
    // Same rule as null: a device we cannot measure gets the good experience.
    expect(motionTier({ ...CAPABLE, deviceYear: YEAR_CLASS_UNKNOWN })).toBe("full");
  });

  it("still reduces on a genuinely weak score", () => {
    expect(motionTier({ ...CAPABLE, deviceYear: 2012 })).toBe("reduced");
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

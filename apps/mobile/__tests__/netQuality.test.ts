/**
 * Link classification. This drives a banner the player sees, so the rule that
 * matters is hysteresis: a single slow round trip is normal on mobile and must
 * NOT flip the banner. Only a sustained pattern counts.
 */

import { describe, expect, it } from "vitest";
import { classify, MIN_SAMPLES, pushRtt, reachableFrom, RTT_WINDOW, SLOW_RTT_MS } from "../src/lib/netQuality";

/** n samples all at the same round trip. */
const flat = (ms: number, n = MIN_SAMPLES): number[] => Array.from({ length: n }, () => ms);

describe("classify", () => {
  it("reads a healthy link as online", () => {
    expect(classify(true, flat(180))).toBe("online");
  });

  it("reads an unreachable radio as offline regardless of past speed", () => {
    expect(classify(false, flat(120))).toBe("offline");
    expect(classify(false, [])).toBe("offline");
  });

  it("does not flip to slow on a single bad sample", () => {
    // The whole point of the window. One 6s call happens on a good link.
    expect(classify(true, [120, 140, SLOW_RTT_MS * 3, 130, 150])).toBe("online");
  });

  it("reads a sustained slow link as slow", () => {
    expect(classify(true, flat(SLOW_RTT_MS + 500))).toBe("slow");
  });

  it("waits for enough evidence before judging speed", () => {
    // Two terrible samples is not yet a pattern — the app has barely started.
    expect(classify(true, flat(SLOW_RTT_MS * 2, MIN_SAMPLES - 1))).toBe("online");
    expect(classify(true, [])).toBe("online");
  });

  it("treats unknown reachability as a speed question, not an outage", () => {
    // Some platforms report null. That is not evidence of an outage, and
    // showing "You're offline" to a player who is fine is worse than silence.
    expect(classify(null, flat(150))).toBe("online");
    expect(classify(null, flat(SLOW_RTT_MS + 500))).toBe("slow");
  });
});

describe("pushRtt", () => {
  it("keeps only the most recent samples", () => {
    let w: number[] = [];
    for (let i = 0; i < RTT_WINDOW + 3; i++) w = pushRtt(w, i);
    expect(w).toHaveLength(RTT_WINDOW);
    expect(w[w.length - 1]).toBe(RTT_WINDOW + 2);
    expect(w[0]).toBe(3);
  });

  it("does not mutate the window it is given", () => {
    const w = [1, 2];
    expect(pushRtt(w, 3)).not.toBe(w);
    expect(w).toEqual([1, 2]);
  });
});

describe("reachableFrom", () => {
  it("prefers actual internet reachability over a mere connection", () => {
    // Captive portals and dead-zone Wi-Fi report connected but unreachable.
    // Trusting isConnected there is exactly the case this app must not miss.
    expect(reachableFrom({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(reachableFrom({ isConnected: true, isInternetReachable: true })).toBe(true);
  });

  it("falls back to the connection flag when reachability is unknown", () => {
    expect(reachableFrom({ isConnected: false })).toBe(false);
    expect(reachableFrom({ isConnected: true })).toBe(true);
  });

  it("says it does not know when the platform reports nothing", () => {
    // Every field on expo-network's NetworkState is optional. Guessing
    // "offline" here would show an outage banner to a player who is fine.
    expect(reachableFrom({})).toBeNull();
  });
});

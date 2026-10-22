/**
 * Ads stopped paying out on 2026-09-25 on both platforms with no client change,
 * and nothing on a phone could say why: every failure path in lib/ads swallowed
 * its error. The diagnostics readout (long-press the version in Settings) is
 * the first place those errors survive, so its wording is the evidence — it has
 * to name the consent answer, the start-up outcome and each format's last error
 * plainly enough to read off a screenshot.
 */

import { describe, expect, it } from "vitest";
import { describeAdsDiagnostics, emptyAdsDiagnostics, noteAdErrorIn } from "../src/lib/ads/diagnostics";

describe("ads diagnostics readout", () => {
  it("says plainly when the ad SDK is not in this build", () => {
    const lines = describeAdsDiagnostics({ ...emptyAdsDiagnostics(), sdk: false });
    expect(lines[0]).toBe("SDK: missing from this build");
  });

  it("names the consent answer and whether ads may be requested", () => {
    const d = { ...emptyAdsDiagnostics(), consent: { status: "OBTAINED", canRequestAds: false, error: null } };
    expect(describeAdsDiagnostics(d)).toContain("Consent: OBTAINED, may request ads: no");
  });

  it("keeps the last error per format with its code and message", () => {
    let d = emptyAdsDiagnostics();
    d = noteAdErrorIn(d, "banner", { code: "googleMobileAds/no-fill", message: "No ad to show." }, 0);
    d = noteAdErrorIn(d, "rewarded", new Error("boom"), 0);
    const lines = describeAdsDiagnostics(d);
    expect(lines).toContain("banner: googleMobileAds/no-fill — No ad to show.");
    expect(lines).toContain("rewarded: boom");
    expect(lines).toContain("interstitial: no error");
  });

  it("never throws on an error shape it does not recognise", () => {
    const d = noteAdErrorIn(emptyAdsDiagnostics(), "banner", "weird", 0);
    expect(describeAdsDiagnostics(d)).toContain("banner: weird");
  });
});

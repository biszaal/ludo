/**
 * The auto-open gate for the streak calendar.
 *
 * Two failure modes this pins, both of which read as the app misbehaving:
 * popping the sheet again on every return to Home (it remounts on each
 * popTo("home")), and popping it at all once the bonus is claimed.
 */

import { describe, it, expect } from "vitest";
import { shouldAutoShow } from "../src/store/dailyBonusStore";

describe("shouldAutoShow", () => {
  it("opens on a fresh install when a bonus is waiting", () => {
    expect(shouldAutoShow({ lastAutoShownDay: null }, true, "2026-08-10")).toBe(true);
  });

  it("stays shut once it has already opened today", () => {
    // The Home-remount case: same day, already shown.
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-10" }, true, "2026-08-10")).toBe(false);
  });

  it("opens again the next day", () => {
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-09" }, true, "2026-08-10")).toBe(true);
  });

  it("stays shut when there is nothing to claim, whatever the day says", () => {
    // bonusClaimable is server-derived, so this also covers a claim made on
    // another device between launches.
    expect(shouldAutoShow({ lastAutoShownDay: null }, false, "2026-08-10")).toBe(false);
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-09" }, false, "2026-08-10")).toBe(false);
  });
});

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
    expect(shouldAutoShow({ lastAutoShownDay: null }, true, "2026-08-10", true)).toBe(true);
  });

  it("stays shut once it has already opened today", () => {
    // The Home-remount case: same day, already shown.
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-10" }, true, "2026-08-10", true)).toBe(false);
  });

  it("opens again the next day", () => {
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-09" }, true, "2026-08-10", true)).toBe(true);
  });

  it("stays shut when there is nothing to claim, whatever the day says", () => {
    // bonusClaimable is server-derived, so this also covers a claim made on
    // another device between launches.
    expect(shouldAutoShow({ lastAutoShownDay: null }, false, "2026-08-10", true)).toBe(false);
    expect(shouldAutoShow({ lastAutoShownDay: "2026-08-09" }, false, "2026-08-10", true)).toBe(false);
  });

  it("waits until the player has finished a first game", () => {
    // A brand-new player lands on Home from the name screen. A calendar (and,
    // after a claim, the notification ask) in front of PLAY is two popups
    // before they have seen a game; it opens on the first return to Home.
    expect(shouldAutoShow({ lastAutoShownDay: null }, true, "2026-08-10", false)).toBe(false);
  });
});

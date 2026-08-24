import { describe, it, expect } from "vitest";
import { gemAdRowView } from "../src/lib/gemAdRow";

const base = {
  flagOn: true,
  tierOn: true,
  adsAvailable: true,
  busy: false,
  amount: 5,
  cap: 5,
};

describe("gem ad row", () => {
  it("shows the payout and what's left once the quota is known", () => {
    const v = gemAdRowView({ ...base, remaining: 3 });
    expect(v).toEqual({ label: "5 gems · 3 of 5 left today", visible: true, spent: false, unavailable: false });
  });

  it("is still live on the last view", () => {
    // Off-by-one guard: 1 remaining must not read as spent, or the final ad of
    // the day becomes uncollectable.
    const v = gemAdRowView({ ...base, remaining: 1 });
    expect(v.spent).toBe(false);
    expect(v.label).toBe("5 gems · 1 of 5 left today");
  });

  it("greys but stays visible when the allowance is gone", () => {
    const v = gemAdRowView({ ...base, remaining: 0 });
    expect(v).toEqual({ label: "None left today", visible: true, spent: true, unavailable: false });
  });

  it("treats an unknown quota as live, never as spent", () => {
    // The whole reason this helper is pure: a failed or in-flight quota call
    // must not hide a reward the player can actually collect.
    const v = gemAdRowView({ ...base, remaining: undefined });
    expect(v.spent).toBe(false);
    expect(v.visible).toBe(true);
    expect(v.label).toBe("5 gems · 5 a day");
  });

  it("singularizes a one-gem payout", () => {
    expect(gemAdRowView({ ...base, amount: 1, remaining: 2 }).label).toBe("1 gem · 2 of 5 left today");
  });

  it("says it's working while a watch is in flight", () => {
    expect(gemAdRowView({ ...base, busy: true, remaining: 3 }).label).toBe("Loading…");
  });

  it("hides entirely when the placement or tier is off", () => {
    // Switched OFF is different from cannot serve right now: off means the
    // offer does not exist, and nothing should hint that it might.
    expect(gemAdRowView({ ...base, flagOn: false, remaining: 3 }).visible).toBe(false);
    expect(gemAdRowView({ ...base, tierOn: false, remaining: 3 }).visible).toBe(false);
    expect(gemAdRowView({ ...base, serverEnabled: false, remaining: 3 }).visible).toBe(false);
  });

  it("stays on screen, greyed, when the SDK cannot serve an ad", () => {
    // A build without the ad SDK (Expo Go, a dev client from before ads
    // landed) or a runtime that cannot fetch one. The offer is real and
    // switched on, so it keeps its place in the layout rather than leaving a
    // hole — but it says it is not ready and cannot be tapped into a failure.
    const v = gemAdRowView({ ...base, adsAvailable: false, remaining: 3 });
    expect(v.visible).toBe(true);
    expect(v.unavailable).toBe(true);
    expect(v.label).toBe("Not available right now");
  });

  it("is not 'unavailable' merely because the day's allowance is gone", () => {
    // Spent and unavailable are different answers: come back tomorrow versus
    // this build cannot show you an ad at all.
    const v = gemAdRowView({ ...base, remaining: 0 });
    expect(v.spent).toBe(true);
    expect(v.unavailable).toBe(false);
  });

  it("stays visible on a server too old to report enablement", () => {
    expect(gemAdRowView({ ...base, serverEnabled: undefined, remaining: 3 }).visible).toBe(true);
  });
});

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
    expect(v).toEqual({ label: "5 gems · 3 of 5 left today", visible: true, spent: false });
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
    expect(v).toEqual({ label: "None left today", visible: true, spent: true });
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
    expect(gemAdRowView({ ...base, flagOn: false, remaining: 3 }).visible).toBe(false);
    expect(gemAdRowView({ ...base, tierOn: false, remaining: 3 }).visible).toBe(false);
    expect(gemAdRowView({ ...base, adsAvailable: false, remaining: 3 }).visible).toBe(false);
    expect(gemAdRowView({ ...base, serverEnabled: false, remaining: 3 }).visible).toBe(false);
  });

  it("stays visible on a server too old to report enablement", () => {
    expect(gemAdRowView({ ...base, serverEnabled: undefined, remaining: 3 }).visible).toBe(true);
  });
});

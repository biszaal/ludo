/**
 * The update floor is a dotted numeric version. Anything we cannot order —
 * empty, missing, or a typo — must not count as "below", because that is what
 * blocks a player.
 */

import { describe, expect, it } from "vitest";
import { AppVersionGate } from "../src/lib/appVersionGate";

describe("AppVersionGate.compare", () => {
  it("orders dotted numeric versions segment by segment", () => {
    expect(AppVersionGate.compare("1.2.2", "1.3.0")).toBe(-1);
    expect(AppVersionGate.compare("1.3.0", "1.3.1")).toBe(-1);
    expect(AppVersionGate.compare("1.3.0", "1.3.0")).toBe(0);
    expect(AppVersionGate.compare("1.10.0", "1.9.0")).toBe(1);
    expect(AppVersionGate.compare("2.0.0", "1.9.9")).toBe(1);
  });

  it("treats a missing segment as zero", () => {
    expect(AppVersionGate.compare("1.3", "1.3.0")).toBe(0);
    expect(AppVersionGate.compare("1.3.0", "1.3")).toBe(0);
    expect(AppVersionGate.compare("1.3.1", "1.3")).toBe(1);
    expect(AppVersionGate.compare("1", "1.0.0")).toBe(0);
  });

  it("ignores surrounding whitespace", () => {
    expect(AppVersionGate.compare("  1.3.0  ", "1.3.0")).toBe(0);
  });

  it("refuses strings that are not plain dotted numbers", () => {
    expect(AppVersionGate.compare("v1.3.0", "1.3.0")).toBeNull();
    expect(AppVersionGate.compare("1.3.0-rc.1", "1.3.0")).toBeNull();
    expect(AppVersionGate.compare("1.3.0", "latest")).toBeNull();
    expect(AppVersionGate.compare("1..3", "1.3.0")).toBeNull();
    expect(AppVersionGate.compare("", "1.3.0")).toBeNull();
    expect(AppVersionGate.compare("1.3.0", "")).toBeNull();
  });
});

describe("AppVersionGate.below", () => {
  it("is true only when current is strictly older than a real floor", () => {
    expect(AppVersionGate.below("1.2.2", "1.3.0")).toBe(true);
    expect(AppVersionGate.below("1.3.0", "1.3.0")).toBe(false);
    expect(AppVersionGate.below("1.3.1", "1.3.0")).toBe(false);
    expect(AppVersionGate.below("1.3.0", "1.3")).toBe(false);
  });

  it("fails open when the floor or the current version cannot be ordered", () => {
    expect(AppVersionGate.below("1.3.0", "")).toBe(false);
    expect(AppVersionGate.below("1.3.0", "   ")).toBe(false);
    expect(AppVersionGate.below("1.3.0", "latest")).toBe(false);
    expect(AppVersionGate.below("1.3.0", "v1.4.0")).toBe(false);
    expect(AppVersionGate.below("", "1.0.0")).toBe(false);
    expect(AppVersionGate.below("v1.2.2", "9.0.0")).toBe(false);
  });
});

describe("AppVersionGate.storeUrl", () => {
  it("points Android at the Play Store listing", () => {
    expect(AppVersionGate.storeUrl("android")).toBe(
      "https://play.google.com/store/apps/details?id=com.biszaal.mobile",
    );
  });

  it("points iOS at the App Store listing", () => {
    expect(AppVersionGate.storeUrl("ios")).toBe("https://apps.apple.com/app/id6788536072");
  });

  it("has no store anywhere else", () => {
    expect(AppVersionGate.storeUrl("web")).toBeNull();
    expect(AppVersionGate.storeUrl("")).toBeNull();
  });
});

/**
 * Dock/tab rules: which screens carry the persistent bottom dock, which tab
 * reads as active on each, and how a dock press moves the nav stack.
 *
 * These are pure so ScreenStack keeps no branching logic of its own — there is
 * no RN renderer in this suite, so anything decided inside JSX is untestable.
 */

import { describe, it, expect } from "vitest";
import { activeTabFor, dockClearance, stackShowsDock, tabNavOp } from "../src/lib/tabs";

describe("stackShowsDock", () => {
  it("carries the dock on the doorways away from home", () => {
    expect(stackShowsDock("shop")).toBe(true);
    expect(stackShowsDock("friends")).toBe(true);
    expect(stackShowsDock("account")).toBe(true);
  });

  it("leaves home alone — the hub draws its own dock inside its budget", () => {
    expect(stackShowsDock("home")).toBe(false);
  });

  it("hides the dock while a game or lobby is on screen", () => {
    expect(stackShowsDock("localGame")).toBe(false);
    expect(stackShowsDock("onlineGame")).toBe(false);
    expect(stackShowsDock("lobby")).toBe(false);
  });

  it("hides the dock on screens reached from inside a tab", () => {
    expect(stackShowsDock("settings")).toBe(false);
    expect(stackShowsDock("profile")).toBe(false);
    expect(stackShowsDock("addFriend")).toBe(false);
    expect(stackShowsDock("playerProfile")).toBe(false);
  });

  it("hides the dock on how to play — it is a leaf, not a tab", () => {
    expect(stackShowsDock("howToPlay")).toBe(false);
  });
});

describe("activeTabFor", () => {
  it("marks the doorway you are standing in", () => {
    expect(activeTabFor("home")).toBe("home");
    expect(activeTabFor("shop")).toBe("shop");
    expect(activeTabFor("friends")).toBe("friends");
    expect(activeTabFor("account")).toBe("account");
  });

  it("highlights nothing on a screen that is not a tab", () => {
    expect(activeTabFor("settings")).toBeNull();
    expect(activeTabFor("howToPlay")).toBeNull();
  });
});

describe("tabNavOp", () => {
  it("pushes the first doorway opened from the hub", () => {
    expect(tabNavOp("home", "shop")).toEqual({ op: "push", name: "shop" });
  });

  it("replaces rather than stacks when moving between doorways", () => {
    expect(tabNavOp("shop", "friends")).toEqual({ op: "replace", name: "friends" });
    expect(tabNavOp("friends", "account")).toEqual({ op: "replace", name: "account" });
  });

  it("unwinds to the hub instead of pushing a second copy of it", () => {
    expect(tabNavOp("shop", "home")).toEqual({ op: "popTo", name: "home" });
  });

  it("does nothing when you tap the doorway you are already in", () => {
    expect(tabNavOp("shop", "shop")).toEqual({ op: "none" });
    expect(tabNavOp("home", "home")).toEqual({ op: "none" });
  });
});

describe("dockClearance", () => {
  it("reserves the tray, its padding and the home indicator", () => {
    // 64pt tray + 8 above it + a 34pt indicator, which stands in for the
    // bottom pad rather than stacking on top of it.
    expect(dockClearance(1, 34)).toBe(106);
  });

  it("scales the tray with the screen", () => {
    expect(dockClearance(1.5, 0)).toBeGreaterThan(dockClearance(1, 0));
  });

  it("keeps a floor under the padding when there is no inset", () => {
    expect(dockClearance(1, 0)).toBe(80);
  });
});

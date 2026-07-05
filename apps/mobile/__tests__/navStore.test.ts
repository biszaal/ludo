/**
 * Nav stack semantics: push/replace/pop/popTo/reset, root protection, and the
 * unique keys ScreenStack relies on for remount + transition animations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useNav } from "../src/store/navStore";

const nav = useNav;

function names(): string[] {
  return nav.getState().stack.map((e) => e.name);
}

beforeEach(() => {
  nav.getState().reset("home");
});

describe("nav stack", () => {
  it("starts at home and never pops the root", () => {
    expect(names()).toEqual(["home"]);
    nav.getState().pop();
    expect(names()).toEqual(["home"]);
  });

  it("pushes and pops in order", () => {
    nav.getState().push("settings");
    nav.getState().push("profile");
    expect(names()).toEqual(["home", "settings", "profile"]);
    expect(nav.getState().lastOp).toBe("push");
    nav.getState().pop();
    expect(names()).toEqual(["home", "settings"]);
    expect(nav.getState().lastOp).toBe("pop");
  });

  it("replace swaps the top entry (lobby → onlineGame)", () => {
    nav.getState().push("lobby");
    nav.getState().replace("onlineGame");
    expect(names()).toEqual(["home", "onlineGame"]);
    nav.getState().pop();
    expect(names()).toEqual(["home"]); // back never returns to the dead lobby
  });

  it("popTo unwinds to the nearest match", () => {
    nav.getState().push("localGame");
    nav.getState().push("howToPlay");
    nav.getState().popTo("home");
    expect(names()).toEqual(["home"]);
  });

  it("popTo resets when the target is not on the stack", () => {
    nav.getState().push("settings");
    nav.getState().popTo("stats");
    expect(names()).toEqual(["stats"]);
    expect(nav.getState().lastOp).toBe("reset");
  });

  it("popTo on the current top is a no-op", () => {
    nav.getState().push("settings");
    const before = nav.getState().stack;
    nav.getState().popTo("settings");
    expect(nav.getState().stack).toBe(before);
  });

  it("assigns a fresh key on every push so remounts animate", () => {
    nav.getState().push("settings");
    const first = nav.getState().stack.at(-1)!.key;
    nav.getState().pop();
    nav.getState().push("settings");
    const second = nav.getState().stack.at(-1)!.key;
    expect(first).not.toBe(second);
  });
});

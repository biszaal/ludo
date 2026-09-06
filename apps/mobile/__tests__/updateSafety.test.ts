/**
 * The OTA reload rule.
 *
 * These are not tests of a formula, they are tests of a promise: the app must
 * never restart itself out from under a player who is mid-anything. Every
 * "false" case here is a bug report someone would otherwise have filed as
 * "the game crashed and I lost my coins".
 */

import { describe, expect, it } from "vitest";
import { canApplyUpdate } from "../src/lib/updateSafety";

const AT_REST = { inOnlineGame: false, inLocalGame: false, screens: ["home"] };

describe("canApplyUpdate", () => {
  it("applies at rest on home", () => {
    expect(canApplyUpdate(AT_REST)).toBe(true);
  });

  it("never applies during an online game", () => {
    // The expensive case: a staked table, where a reload drops the seat to the
    // stall bot and the pot goes with it.
    expect(canApplyUpdate({ ...AT_REST, inOnlineGame: true })).toBe(false);
    expect(
      canApplyUpdate({ inOnlineGame: true, inLocalGame: false, screens: ["home", "onlineGame"] }),
    ).toBe(false);
  });

  it("never applies during a local game", () => {
    expect(canApplyUpdate({ ...AT_REST, inLocalGame: true })).toBe(false);
  });

  it("never applies while a lobby is open", () => {
    // gameId is set on joining, but a player waiting for a room to fill has
    // not necessarily got one yet — the screen check is what covers the gap.
    expect(canApplyUpdate({ ...AT_REST, screens: ["home", "lobby"] })).toBe(false);
  });

  it("never applies on a screen pushed over home", () => {
    // Each of these can hold work in progress: a purchase, a typed username,
    // a friend code half entered.
    for (const screen of ["shop", "settings", "account", "profile", "addFriend"]) {
      expect(canApplyUpdate({ ...AT_REST, screens: ["home", screen] })).toBe(false);
    }
  });

  it("is a whitelist, so an unknown future screen is unsafe by default", () => {
    // The point of the assertion: a screen added later must fail closed
    // without anyone remembering to come back and edit this rule.
    expect(canApplyUpdate({ ...AT_REST, screens: ["home", "somethingNew"] })).toBe(false);
    expect(canApplyUpdate({ ...AT_REST, screens: ["somethingNew"] })).toBe(false);
  });

  it("does not apply to an empty stack", () => {
    expect(canApplyUpdate({ ...AT_REST, screens: [] })).toBe(false);
  });
});

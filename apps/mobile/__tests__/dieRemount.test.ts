/**
 * The die's roll must survive the die changing corners.
 *
 * The die is rendered beside one seat, so moving it to another seat REMOUNTS
 * it. A fresh Dice used to skip whatever roll it mounted into — right when the
 * die is simply catching up with a roll it already played, wrong when the roll
 * starts in the same render that moves it. That second case is reachable
 * whenever a roll starts while the die is still held at the previous roller's
 * corner (useDieHandover): onlineStore's row hold and the hook's own timer are
 * both dieHandoverMs long, but the store arms its timer first, so a parked roll
 * broadcast fired a few ms before the hold let go. The tumble then started at
 * the old corner and was dropped by the remount. Reported 2026-10-09 on iPhone:
 * "die roll animation not showing sometimes".
 */

import { describe, expect, it } from "vitest";
import { rollsOnMount, standingHold } from "../src/lib/moveTiming";

describe("a die that has just mounted", () => {
  it("plays a roll no die has played yet", () => {
    expect(rollsOnMount(8, 7)).toBe(true);
  });

  it("does not replay a roll it is only catching up with", () => {
    // The hold ended and the die moved to the next seat: same roll, already seen.
    expect(rollsOnMount(8, 8)).toBe(false);
  });

  it("has nothing to play before the first roll of a game", () => {
    expect(rollsOnMount(0, 5)).toBe(false);
  });
});

describe("a held die", () => {
  const held = { playerId: "p1", value: 5, seq: 3 };

  it("stays at the roller's corner while no new roll has started", () => {
    expect(standingHold(held, 3)).toEqual({ playerId: "p1", value: 5 });
  });

  it("lets go the moment the next roll starts, in that same render", () => {
    // Otherwise the new roll begins at the old corner and is lost to the remount.
    expect(standingHold(held, 4)).toBeNull();
  });

  it("is nothing when nothing is held", () => {
    expect(standingHold(null, 4)).toBeNull();
  });
});

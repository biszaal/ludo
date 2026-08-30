/**
 * The game clock. Two things matter: the anchor is per game (a rematch is a
 * fresh game and must start from zero, a remount of the same game must not),
 * and the display never shows a negative or a jumping value.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clockStartFor, elapsedSeconds, formatElapsed, resetGameClock } from "../src/lib/gameClock";

beforeEach(() => resetGameClock());

describe("clockStartFor", () => {
  it("anchors on first sight and holds it for the same game", () => {
    expect(clockStartFor("g1", 1000)).toBe(1000);
    expect(clockStartFor("g1", 9000)).toBe(1000); // remount mid-game
  });

  it("re-anchors on a new game id (rematch)", () => {
    clockStartFor("g1", 1000);
    expect(clockStartFor("g2", 9000)).toBe(9000);
  });

  it("re-anchors if the old game comes back after another one", () => {
    clockStartFor("g1", 1000);
    clockStartFor("g2", 5000);
    expect(clockStartFor("g1", 9000)).toBe(9000);
  });
});

describe("elapsedSeconds", () => {
  it("floors to whole seconds", () => {
    expect(elapsedSeconds(1000, 1000)).toBe(0);
    expect(elapsedSeconds(1000, 1999)).toBe(0);
    expect(elapsedSeconds(1000, 2000)).toBe(1);
    expect(elapsedSeconds(0, 90_500)).toBe(90);
  });

  it("never goes negative when the clock skews backwards", () => {
    expect(elapsedSeconds(5000, 1000)).toBe(0);
  });
});

describe("formatElapsed", () => {
  it("shows m:ss with padded seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7)).toBe("0:07");
    expect(formatElapsed(65)).toBe("1:05");
    expect(formatElapsed(599)).toBe("9:59");
    expect(formatElapsed(3599)).toBe("59:59");
  });

  it("grows to h:mm:ss past an hour", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3723)).toBe("1:02:03");
    expect(formatElapsed(36_000)).toBe("10:00:00");
  });

  it("is defensive about junk", () => {
    expect(formatElapsed(-5)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });
});

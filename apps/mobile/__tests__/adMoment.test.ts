/**
 * When the end-of-match interstitial is allowed to run.
 *
 * The bug this pins: in a 3- or 4-handed game the champion stops racing the
 * moment their last token comes home, while everyone else is still walking
 * theirs around the board. `seatFinish` correctly reports them as done, the
 * winner sheet opens with a "Watch the rest" button — and that button ran the
 * end-of-match ad. A full-screen takeover dropped over a live match, and then
 * the player was returned to it.
 *
 * The rule: an ad may interrupt the END of a game, never the MIDDLE of one.
 */

import { describe, expect, it } from "vitest";
import { matchOverForSeat } from "../src/lib/seatFinish";

const racing = { placed: false };
const placedSeat = { placed: true };

describe("matchOverForSeat", () => {
  describe("while the match is still running", () => {
    const finished = false;

    it("refuses the champion who stays to watch the rest — the reported bug", () => {
      // The champion IS placed, and IS done racing. Neither makes the MATCH
      // over, and "Watch the rest" means they are going straight back to it.
      expect(matchOverForSeat(placedSeat, { finished, intent: "stay" })).toBe(false);
    });

    it("refuses a seat still walking tokens home, whatever they tap", () => {
      expect(matchOverForSeat(racing, { finished, intent: "stay" })).toBe(false);
      // Quitting mid-race is a forfeit, often of a stake. The last moment to
      // monetise someone is the moment they lose money.
      expect(matchOverForSeat(racing, { finished, intent: "leave" })).toBe(false);
    });

    it("allows a finished seat that leaves early", () => {
      // Their placement is banked, they have declined to watch the rest, and
      // the next screen is home either way.
      expect(matchOverForSeat(placedSeat, { finished, intent: "leave" })).toBe(true);
    });
  });

  describe("once every player has finished", () => {
    const finished = true;

    it("allows it on either intent", () => {
      expect(matchOverForSeat(placedSeat, { finished, intent: "stay" })).toBe(true);
      expect(matchOverForSeat(placedSeat, { finished, intent: "leave" })).toBe(true);
    });

    it("allows it even for a seat that never placed", () => {
      // A seat that walked out earlier, or a spectator: the match is over for
      // the table, so it is over for them too.
      expect(matchOverForSeat(racing, { finished, intent: "stay" })).toBe(true);
      expect(matchOverForSeat(racing, { finished, intent: "leave" })).toBe(true);
    });
  });

  it("only ever allows an ad at a moment the game is over for that seat", () => {
    // Exhaustive: the one false-in-every-cell row is the seat still racing
    // mid-match, and the one true-in-every-cell row is the finished match.
    const rows = [
      { finished: false, placed: false, stay: false, leave: false },
      { finished: false, placed: true, stay: false, leave: true },
      { finished: true, placed: false, stay: true, leave: true },
      { finished: true, placed: true, stay: true, leave: true },
    ] as const;
    for (const r of rows) {
      expect(matchOverForSeat({ placed: r.placed }, { finished: r.finished, intent: "stay" })).toBe(r.stay);
      expect(matchOverForSeat({ placed: r.placed }, { finished: r.finished, intent: "leave" })).toBe(r.leave);
    }
  });
});

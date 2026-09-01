/**
 * When a guest gets asked to secure their account.
 *
 * The point of pinning this is restraint rather than reach. Four separate
 * moments were asked for — a purchase, a balance worth losing, a few games in,
 * and a standing banner — and four triggers wired independently is a player
 * being interrupted four times, which teaches them to dismiss the thing without
 * reading it. So three of them share one budget and one cooldown, and the
 * fourth (the banner) is passive and costs nothing.
 *
 * The failure this exists to prevent is not "we didn't ask". It is a player
 * losing paid-for gems on a new phone because the one ask they saw arrived at a
 * moment they had no reason to care about.
 */

import { describe, it, expect } from "vitest";
import {
  SAVE_PROMPT_COOLDOWN_MS,
  SAVE_PROMPT_MAX_ASKS,
  SAVE_PROMPT_MIN_COINS,
  SAVE_PROMPT_MIN_GAMES,
  savePromptReason,
  type SavePromptInput,
} from "../src/lib/savePrompt";

const NOW = 1_700_000_000_000;

/** A guest with nothing worth protecting and no history of being asked. */
const base = (over: Partial<SavePromptInput> = {}): SavePromptInput => ({
  isGuest: true,
  purchasedBalance: 0,
  gems: 0,
  coins: 0,
  gamesPlayed: 0,
  lastAskedAt: null,
  timesAsked: 0,
  now: NOW,
  ...over,
});

describe("savePromptReason", () => {
  it("never asks someone who already has an account", () => {
    // The whole prompt is about becoming recoverable. Asking again is noise,
    // and worse, it implies their account is not safe when it is.
    const saved = base({ isGuest: false, purchasedBalance: 999, gems: 50, gamesPlayed: 99 });
    expect(savePromptReason(saved)).toBeNull();
  });

  it("says nothing to a brand-new guest", () => {
    // Nothing to lose yet, and no reason to trust us with an account. This is
    // the ask that gets dismissed on reflex and poisons the later ones.
    expect(savePromptReason(base())).toBeNull();
  });

  it("asks as soon as real money is involved", () => {
    expect(savePromptReason(base({ purchasedBalance: 1 }))).toBe("purchase");
  });

  it("asks once the balance is worth losing", () => {
    expect(savePromptReason(base({ coins: SAVE_PROMPT_MIN_COINS }))).toBe("balance");
    expect(savePromptReason(base({ coins: SAVE_PROMPT_MIN_COINS - 1 }))).toBeNull();
  });

  it("treats any gems at all as worth protecting", () => {
    // Gems are bought or earned slowly; a single one is not incidental the way
    // a few coins are.
    expect(savePromptReason(base({ gems: 1 }))).toBe("balance");
  });

  it("nudges a player who has stuck around", () => {
    expect(savePromptReason(base({ gamesPlayed: SAVE_PROMPT_MIN_GAMES }))).toBe("played");
    expect(savePromptReason(base({ gamesPlayed: SAVE_PROMPT_MIN_GAMES - 1 }))).toBeNull();
  });

  it("leads with the most urgent reason it has", () => {
    // All three true at once. A player who has just paid should be told about
    // the money, not about having played a few games.
    const all = base({ purchasedBalance: 500, gems: 20, coins: 99_999, gamesPlayed: 40 });
    expect(savePromptReason(all)).toBe("purchase");
    const noPurchase = { ...all, purchasedBalance: 0 };
    expect(savePromptReason(noPurchase)).toBe("balance");
  });

  it("does not ask twice in a row", () => {
    // The cooldown is what turns four triggers into one conversation.
    const justAsked = base({ purchasedBalance: 500, lastAskedAt: NOW - 1, timesAsked: 1 });
    expect(savePromptReason(justAsked)).toBeNull();
  });

  it("comes back once the cooldown is up", () => {
    const later = base({
      purchasedBalance: 500,
      lastAskedAt: NOW - SAVE_PROMPT_COOLDOWN_MS,
      timesAsked: 1,
    });
    expect(savePromptReason(later)).toBe("purchase");
  });

  it("stops asking for good after enough refusals", () => {
    // Past this the banner is the only thing left. Someone who has said no
    // three times has answered the question.
    const spent = base({
      purchasedBalance: 500,
      gems: 99,
      gamesPlayed: 99,
      lastAskedAt: NOW - SAVE_PROMPT_COOLDOWN_MS * 10,
      timesAsked: SAVE_PROMPT_MAX_ASKS,
    });
    expect(savePromptReason(spent)).toBeNull();
  });

  it("stays quiet through ordinary clock skew", () => {
    // A device clock a minute or an hour ahead of when we wrote the stamp still
    // means "we just asked". Reading the gap as elapsed time would unlock the
    // prompt immediately.
    const future = base({ purchasedBalance: 500, lastAskedAt: NOW + 60_000, timesAsked: 1 });
    expect(savePromptReason(future)).toBeNull();
  });

  it("does not wedge itself shut on a nonsense timestamp", () => {
    // The other half of the same problem, and it wants the opposite answer. A
    // stamp written while the clock was wildly wrong would silence the prompt
    // for as long as that error, which could be years. Far enough away is
    // treated as "long ago" so the next ask rewrites it with a sane value —
    // costing at most one early prompt, where the alternative costs all of them.
    const wayFuture = base({
      purchasedBalance: 500,
      lastAskedAt: NOW + SAVE_PROMPT_COOLDOWN_MS * 100,
      timesAsked: 1,
    });
    expect(savePromptReason(wayFuture)).toBe("purchase");
  });

  it("ignores nonsense balances rather than acting on them", () => {
    const negative = base({ coins: -5, gems: -5, purchasedBalance: -5, gamesPlayed: -5 });
    expect(savePromptReason(negative)).toBeNull();
  });
});

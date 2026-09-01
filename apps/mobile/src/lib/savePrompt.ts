/**
 * Whether to ask a guest to secure their account, and what to say.
 *
 * Play is guest-first: the account is an anonymous auth user and every coin,
 * gem, cosmetic and streak hangs off its id (see lib/identity.ts). iOS recovers
 * that through the keychain after a reinstall, but nothing recovers it from a
 * lost, stolen or replaced phone. The only complete answer is a linked identity,
 * and lib/auth.ts has had one all along — buried behind a button in the Account
 * screen that nothing ever pointed at. In August five guest accounts were
 * stranded that way and unpicking one of them took hand-written SQL against
 * production balances.
 *
 * THE HARD PART IS RESTRAINT, NOT REACH. Four moments were wanted — a purchase,
 * a balance worth losing, a few games in, and a standing banner. Wired
 * independently that is a player interrupted four times, which is how you teach
 * someone to dismiss a dialog without reading it. So the three interruptions
 * share one budget and one cooldown and are ranked, while the banner is passive
 * and spends nothing. This module owns that decision so it can be reasoned about
 * in one place and pinned in Node — see __tests__/savePrompt.test.ts.
 *
 * Pure and clock-injected. Nothing here reads Date.now(), and nothing here
 * touches a store.
 */

/** Coins at which an account is worth more than the interruption costs. Roughly
 *  a few won games — enough that starting over would genuinely sting. */
export const SAVE_PROMPT_MIN_COINS = 2_000;

/** Completed games before a player who has bought nothing is nudged. Late
 *  enough to be someone who plays this game, early enough to be before they
 *  have anything to lose. */
export const SAVE_PROMPT_MIN_GAMES = 3;

/** Quiet time between asks. Long enough that a "not now" is respected for
 *  something like a week of ordinary play rather than until the next screen. */
export const SAVE_PROMPT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/** Asks a player ever gets. Past this only the banner remains: three refusals
 *  is an answer, and continuing to ask is nagging someone who told us no. */
export const SAVE_PROMPT_MAX_ASKS = 3;

/** Why we are asking — the copy differs, because a player who has just paid and
 *  a player who has just finished a third game are not in the same situation. */
export type SavePromptReason = "purchase" | "balance" | "played";

export interface SavePromptInput {
  /** False for anyone who already has a recoverable account. */
  isGuest: boolean;
  /** Coins bought with real money, ever. Non-zero means money is at stake. */
  purchasedBalance: number;
  gems: number;
  coins: number;
  gamesPlayed: number;
  /** When we last interrupted them, or null if we never have. */
  lastAskedAt: number | null;
  timesAsked: number;
  now: number;
}

/**
 * The reason to interrupt this player right now, or null to stay quiet.
 *
 * Ranked, because the reasons are not equal: money at stake outranks a balance
 * worth losing, which outranks having simply stuck around. A player who has
 * just bought gems should be told about the gems.
 */
export function savePromptReason(input: SavePromptInput): SavePromptReason | null {
  const { isGuest, lastAskedAt, timesAsked, now } = input;

  // Already recoverable. Asking again does not just waste the moment, it implies
  // their account is at risk when it is not.
  if (!isGuest) return null;
  if (timesAsked >= SAVE_PROMPT_MAX_ASKS) return null;

  if (lastAskedAt !== null) {
    // Math.abs, because device clocks move — and both directions have to be
    // safe. A lastAskedAt in the future would otherwise either unlock the prompt
    // immediately (elapsed reads negative) or wedge it shut for however far the
    // clock jumped. Treating the distance as elapsed keeps a skewed clock quiet
    // now and self-correcting later, which is the right way round: the cost of
    // staying quiet is one missed prompt, and the banner is still there.
    if (Math.abs(now - lastAskedAt) < SAVE_PROMPT_COOLDOWN_MS) return null;
  }

  // Negatives are nonsense rather than a signal — a store that has not loaded,
  // or a bad write. Acting on them would ask at random.
  const purchased = Math.max(0, input.purchasedBalance);
  const gems = Math.max(0, input.gems);
  const coins = Math.max(0, input.coins);
  const games = Math.max(0, input.gamesPlayed);

  if (purchased > 0) return "purchase";
  // Any gem at all: gems are bought, or earned slowly against a daily cap, so
  // one is never incidental the way a handful of coins is.
  if (gems > 0 || coins >= SAVE_PROMPT_MIN_COINS) return "balance";
  if (games >= SAVE_PROMPT_MIN_GAMES) return "played";
  return null;
}

/** What the prompt says, per reason. Kept beside the rule so the two cannot
 *  drift: a prompt that fires for one reason and reads like another is worse
 *  than not asking. */
export function savePromptCopy(reason: SavePromptReason): { title: string; message: string } {
  switch (reason) {
    case "purchase":
      return {
        title: "Keep what you bought",
        message:
          "You're playing as a guest, so this device is the only place your purchase exists. Link an account and it follows you to any phone.",
      };
    case "balance":
      return {
        title: "Don't lose your coins",
        message:
          "You're playing as a guest. Link an account and your coins, gems and cosmetics come with you if you change or lose your phone.",
      };
    case "played":
      return {
        title: "Save your progress",
        message:
          "You're playing as a guest, which lives on this device only. Linking an account takes a moment and keeps everything if the phone doesn't.",
      };
  }
}

/**
 * Whether to show the soft notification ask.
 *
 * The OS gives an app one permission prompt. Spending it at cold start, before
 * the player has won anything or opened a chest, is how it gets a permanent
 * "no". This is the gate in front of that prompt: our own sheet, at a moment
 * of delight, and silence afterwards.
 *
 * Two moments count, and the first one to arrive wins — a first personal win,
 * or a daily-chest claim. A later win is not a moment (the delight was the
 * first one). A later claim is, once the cooldown from a "not now" has passed.
 * Pass-and-play never counts: there is no local "me" to have won.
 *
 * Pure. The sheet, the OS read, and `registerForPush` live in pushPromptOffer.
 */

export type Delight = "first-win" | "claim";

/** Personal wins already banked. `pass` stays 0 — that mode has no local winner. */
export interface WinTotals {
  ai: { won: number };
  pass: { won: number };
  online: { won: number };
}

export interface PromptSignals {
  delight: Delight;
  /**
   * Wins on the books BEFORE this event. A first win passes 0 even though the
   * stats store has already recorded it by the time the sheet can show — the
   * celebration has to finish first, and the increment happens on the win.
   */
  winsBefore: number;
  /** `getPermissionsAsync` came back. False when the module cannot load. */
  permissionKnown: boolean;
  granted: boolean;
  /** False once the OS has said it will not ask again. */
  canAskAgain: boolean;
  /**
   * The settings toggle `registerForPush` consults. Off means accepting the
   * sheet would do nothing — the OS prompt never appears — so we don't ask.
   */
  pushOn: boolean;
  /** The chest-reminder toggle. The sheet promises that nudge, so it stays
   *  hidden when the player has already switched the nudge off. */
  remindersOn: boolean;
  /** When they last chose "not now", or null if they never have. */
  declinedAt: number | null;
  now: number;
}

export class PushPrompt {
  /** A week. Long enough that a "not now" is respected, short enough that a
   *  daily chest still gets another quiet ask. */
  static readonly COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  static countWins(totals: WinTotals): number {
    return totals.ai.won + totals.pass.won + totals.online.won;
  }

  static shouldOffer(s: PromptSignals): boolean {
    if (!s.permissionKnown || s.granted || !s.canAskAgain || !s.pushOn || !s.remindersOn) return false;
    if (s.delight === "first-win" && s.winsBefore !== 0) return false;
    if (s.declinedAt !== null && s.now - s.declinedAt < PushPrompt.COOLDOWN_MS) return false;
    return true;
  }
}

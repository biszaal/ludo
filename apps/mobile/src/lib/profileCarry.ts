/**
 * Whether the name on this device still belongs to the player who is now
 * signed in.
 *
 * Pure and dependency-light (no supabase, no react-native) so the Node suite
 * can exercise the rule directly — the same split as motionTier.ts/useMotion.ts
 * and netQuality.ts/connection.ts. lib/auth.ts is the only caller.
 *
 * The failure this exists to prevent, observed in production on 2026-09-05:
 * an Apple account with 49,925 coins and no `profiles` row at all, while the
 * Account screen showed the username "Bishal" — a name registered to a
 * DIFFERENT (Google) account on the same device.
 *
 * The chain was silent at every step. hydrateProfileFromServer read no profile
 * row for the newly signed-in account and returned early, leaving the previous
 * account's name in the store. initProfileSync then pushed that name, the
 * unique index (0006) refused it because the other account holds it,
 * upsertMyProfile returned null on the error, and pushProfile's
 * `if (!stored) return` swallowed it. So the row was never created: the account
 * wore a name it did not own, could never register it, and appeared to every
 * opponent as a bare colour label.
 *
 * Reading a name off the server was never the problem. Keeping one when the
 * server had none to give was.
 */

/** What should happen to the locally-stored display name after signing in. */
export type NameCarry =
  /** The account has a registered name — wear it. */
  | { action: "adopt"; name: string }
  /** Same account, nothing registered yet — the local name is still the player's own. */
  | { action: "keep" }
  /** A different account with no name — fall back to this device's guest handle. */
  | { action: "reset" };

export interface CarrySignals {
  /** The signed-in user id BEFORE this auth operation. Null on a cold start. */
  previousUserId: string | null;
  /** The signed-in user id after it. */
  currentUserId: string;
  /** The name the server has registered for `currentUserId`, if any. */
  serverName: string | null;
}

/**
 * Decide it.
 *
 * Three rules, and the middle one is why this is not simply "reset when the
 * server has no name":
 *
 * A registered name always wins. That is the whole point of signing in — a
 * restored account must look like itself and not like this device.
 *
 * On the LINK path the user id does not change, and there the local name is the
 * player's own: they may have picked it moments ago as a guest, with
 * initProfileSync's 1200ms debounce still pending, so no row exists yet.
 * Resetting there would throw away the name they just chose, which is a worse
 * bug than the one this fixes.
 *
 * On the SIGN-IN path the id changes, and a name that came from the account
 * being left behind must not follow. It is not this player's to wear, it is
 * very likely already registered to the account they just signed out of, and
 * keeping it guarantees the deadlock described in the file header.
 *
 * A null `previousUserId` reads as "keep": there is no prior account for a name
 * to have leaked from, and the local store holds this device's own guest handle
 * or the name the player picked before signing in for the first time.
 */
export function nameAfterAuth(s: CarrySignals): NameCarry {
  if (s.serverName && s.serverName.trim().length > 0) {
    return { action: "adopt", name: s.serverName };
  }
  const switchedAccount = s.previousUserId !== null && s.previousUserId !== s.currentUserId;
  return switchedAccount ? { action: "reset" } : { action: "keep" };
}

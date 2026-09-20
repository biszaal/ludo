/**
 * Whether to put the first-run name question to this device at all.
 *
 * Pure and dependency-light (no supabase, no react-native) so the rule can be
 * exercised in Node — the same split as savePrompt.ts/useSavePrompt.ts and
 * profileCarry.ts. lib/useNamePrompt.ts is the only caller.
 *
 * The question ChooseNameScreen asks — "What should we call you?" — is only a
 * sensible thing to ask a player who has no name yet. A saved account already
 * has one, registered, unique-indexed and known to their friends, and asking
 * again is worse than pointless: the screen's own copy says "you can change
 * this once later", so it is offering to spend an allowance (0030) on a name
 * the player chose long ago.
 *
 * That combination turns up on every reinstall. AsyncStorage goes with the app,
 * so `namePromptSeen` is false and this device has minted itself a fresh
 * guest handle — but the keychain still holds the refresh token (lib/identity),
 * so the account that comes back is the player's real one. First launch after a
 * reinstall looked exactly like a first launch ever.
 */

export interface NamePromptSignals {
  /** Has this device been offered the prompt before? (profileStore) */
  promptSeen: boolean;
  /**
   * Is the restored session a not-yet-saved guest — or `null` while we are
   * still finding out?
   *
   * `null` is not "assume guest". The session is read asynchronously and the
   * hub is already on screen behind this, so guessing wrong paints the prompt
   * over it and then snatches it away a frame later. Waiting costs a beat on a
   * genuinely new install; guessing costs a flash on every reinstall.
   */
  isGuest: boolean | null;
}

export function askForName(s: NamePromptSignals): boolean {
  if (s.promptSeen) return false;
  return s.isGuest === true;
}

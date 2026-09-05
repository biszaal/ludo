/**
 * A name must not follow a player onto an account that is not theirs.
 *
 * Pinned from a real production state found on 2026-09-05: an Apple account
 * holding 49,925 coins and 362 gems with NO `profiles` row, while the Account
 * screen displayed the username "Bishal" — registered to a different (Google)
 * account on the same device.
 *
 * Every step of that failure was silent, which is why it needs a test rather
 * than a code review. hydrateProfileFromServer found no row and returned early,
 * leaving the old name in place; initProfileSync pushed it; the unique index
 * (0006) refused it; upsertMyProfile returned null; pushProfile's
 * `if (!stored) return` swallowed the refusal. Nothing logged, nothing warned,
 * and the account could never register a name again.
 *
 * The middle case below is the one that makes this rule non-obvious: on the
 * LINK path the id does not change and the local name IS the player's own,
 * possibly picked seconds earlier with the sync debounce still pending.
 */

import { describe, it, expect } from "vitest";
import { nameAfterAuth, type CarrySignals } from "../src/lib/profileCarry";

const GUEST = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = "22222222-2222-2222-2222-222222222222";

/** Signing in to an account that has never registered a name. */
const base: CarrySignals = {
  previousUserId: GUEST,
  currentUserId: ACCOUNT,
  serverName: null,
};

describe("nameAfterAuth", () => {
  it("wears the name the account actually registered", () => {
    expect(nameAfterAuth({ ...base, serverName: "Bishal" })).toEqual({ action: "adopt", name: "Bishal" });
  });

  it("drops the previous account's name when signing in to a nameless account", () => {
    // The exact production case: the local store held "Bishal" from the Google
    // account, and the Apple account had no row of its own.
    expect(nameAfterAuth(base)).toEqual({ action: "reset" });
  });

  it("keeps the local name when linking, because the id did not change", () => {
    // Linking a provider to the CURRENT user. A name picked moments ago may
    // still be sitting behind initProfileSync's 1200ms debounce with no row
    // written yet — resetting here would throw away the player's own choice.
    expect(nameAfterAuth({ ...base, previousUserId: ACCOUNT })).toEqual({ action: "keep" });
  });

  it("keeps the local name on a cold start, where nothing could have leaked", () => {
    expect(nameAfterAuth({ ...base, previousUserId: null })).toEqual({ action: "keep" });
  });

  it("treats a blank registered name as no name at all", () => {
    // A whitespace-only display_name must not be adopted — setName would fall
    // straight back to the guest handle anyway, and "adopt" would wrongly
    // report that the account has an identity.
    expect(nameAfterAuth({ ...base, serverName: "   " })).toEqual({ action: "reset" });
  });

  it("still adopts a registered name when the account did not change", () => {
    // A refresh of the same account: the server's copy is the authority.
    expect(nameAfterAuth({ previousUserId: ACCOUNT, currentUserId: ACCOUNT, serverName: "Bishal" })).toEqual({
      action: "adopt",
      name: "Bishal",
    });
  });
});

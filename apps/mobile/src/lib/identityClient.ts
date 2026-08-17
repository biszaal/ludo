/**
 * The live wiring for lib/identity.ts: Supabase auth on one side, the device
 * keychain on the other.
 *
 * Split from identity.ts so the rules stay testable in Node — this half is the
 * part that cannot run without native modules.
 *
 * The keychain copy is deliberately just the refresh token, not the whole
 * session. It is short, it is the only part that can rebuild a session, and
 * keeping the access token out of a store that outlives the app is one less
 * long-lived credential lying around. AsyncStorage remains the working session
 * store; this is purely the lifeline for when AsyncStorage is gone.
 */

import * as SecureStore from "expo-secure-store";
import { getSupabase } from "./supabase";
import { createIdentity, type Identity, type IdentitySession } from "./identity";

/** Keychain entry holding the refresh token. Renaming this strands every
 *  installed player's recovery token, so don't. */
const STASH_KEY = "ludo.guest.refresh";

const STASH_OPTIONS: SecureStore.SecureStoreOptions = {
  // Readable after the first unlock following a reboot: the app can be woken
  // (push, background refresh) before the player has unlocked the phone, and
  // WHEN_UNLOCKED would make identity look missing at exactly that moment.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

let identity: Identity | null = null;

/** Lazily built so importing this module never touches native code at load. */
export function getIdentity(): Identity {
  if (identity) return identity;
  const supabase = getSupabase();

  identity = createIdentity({
    getSession: async () => {
      const { data } = await supabase.auth.getSession();
      return toIdentitySession(data.session);
    },

    refreshSession: async (refreshToken) => {
      const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      if (error) return null;
      return toIdentitySession(data.session);
    },

    signInAnonymously: async () => {
      const { data, error } = await supabase.auth.signInAnonymously();
      const session = toIdentitySession(data.session);
      if (error || !session) {
        throw new Error(
          `Sign-in failed: ${error?.message ?? "unknown"}. Enable anonymous sign-ins in Supabase Auth.`,
        );
      }
      return session;
    },

    readStash: () => SecureStore.getItemAsync(STASH_KEY, STASH_OPTIONS),
    writeStash: (token) => SecureStore.setItemAsync(STASH_KEY, token, STASH_OPTIONS),
    clearStash: () => SecureStore.deleteItemAsync(STASH_KEY, STASH_OPTIONS),
  });

  // Refresh tokens rotate on every use, and a stale one is a revoked one. Riding
  // the auth events keeps the keychain holding the token the server will still
  // accept — which is the whole difference between recovering an account after a
  // reinstall and silently becoming a new player.
  //
  // SIGNED_OUT is pointedly NOT handled here: a dropped session should leave the
  // lifeline intact so the next launch can pull the account back. Genuinely
  // forgetting an identity is an explicit act (lib/auth.ts), not an event.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") return;
    void identity?.rememberSession(toIdentitySession(session));
  });

  return identity;
}

/** Deliberately forget the current identity — sign-out and account deletion
 *  only, where landing on a genuinely new guest is the point. */
export async function forgetIdentity(): Promise<void> {
  await getIdentity().forgetIdentity();
}

function toIdentitySession(session: { user: { id: string }; refresh_token: string } | null): IdentitySession | null {
  if (!session?.refresh_token) return null;
  return { userId: session.user.id, refreshToken: session.refresh_token };
}

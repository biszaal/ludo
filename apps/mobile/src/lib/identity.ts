/**
 * Who the player IS, and how that survives.
 *
 * Play is guest-first: the account is an anonymous auth user, and every coin,
 * gem, cosmetic and streak hangs off its id. That makes this module the most
 * consequential code in the app — get it wrong and a player loses everything
 * they bought, with no error anywhere.
 *
 * Two production failures shaped it, both of them silent:
 *
 *   Duplicate guests. `ensureSignedIn` used to be "no session? sign in", with
 *   nothing serialising the callers. Startup fires many at once (App.tsx's
 *   RevenueCat attach, the friends/presence/profile syncs, each store's
 *   refresh), so a session-less launch called signInAnonymously() four or five
 *   times CONCURRENTLY and the server duly created four or five users. One
 *   session won AsyncStorage; the others kept serving requests from callers
 *   holding their tokens, so real writes — including a paid quick-match stake —
 *   landed on accounts nobody would ever see again. The single-flight promise
 *   below is what makes "sign me in" mean one identity.
 *
 *   Lost guests. The session lived only in AsyncStorage, which a reinstall (or
 *   a build with a fresh container) wipes. The app then minted a NEW guest and
 *   looked like a first launch — fresh coins, no cosmetics, streak back to day
 *   one — while the real account sat intact and unreachable on the server. So
 *   the refresh token is mirrored into the keychain, which on iOS outlives
 *   deleting the app: a wiped device recovers the SAME user instead of becoming
 *   a stranger. (Android clears its keystore entry on uninstall, so there it
 *   only covers the fresh-container case. Saving a real account is still the
 *   only complete answer, and lib/auth.ts is where that happens.)
 *
 * Everything is injected so the matrix is testable in Node — no native keychain,
 * no network. See __tests__/identity.test.ts.
 */

/** A session reduced to the two things identity actually needs. */
export interface IdentitySession {
  userId: string;
  refreshToken: string;
}

export interface IdentityDeps {
  /** The live session, or null when there is none. */
  getSession: () => Promise<IdentitySession | null>;
  /** Trade a stashed refresh token for a session; null if the server refuses. */
  refreshSession: (refreshToken: string) => Promise<IdentitySession | null>;
  /** Create a brand-new anonymous user. Throws if it cannot. */
  signInAnonymously: () => Promise<IdentitySession>;
  readStash: () => Promise<string | null>;
  writeStash: (refreshToken: string) => Promise<void>;
  clearStash: () => Promise<void>;
}

export interface Identity {
  /** The current user id, recovering or creating one as needed. Concurrent
   *  callers share a single attempt and therefore a single identity. */
  ensureSignedIn: () => Promise<string>;
  /** Keep the keychain copy current — call on every token rotation. */
  rememberSession: (session: IdentitySession | null) => Promise<void>;
  /** Drop the recovery token so the next sign-in starts a genuinely new guest.
   *  Only for a deliberate sign-out or account deletion. */
  forgetIdentity: () => Promise<void>;
}

export function createIdentity(deps: IdentityDeps): Identity {
  // The whole point of the single-flight: one in-flight attempt, shared. It is
  // cleared on settle (including rejection) so an offline launch retries rather
  // than caching the failure for the life of the process.
  let inFlight: Promise<string> | null = null;

  const remember = async (session: IdentitySession | null): Promise<void> => {
    if (!session?.refreshToken) return;
    try {
      await deps.writeStash(session.refreshToken);
    } catch {
      // A keychain write failing costs durability, never the session in hand.
    }
  };

  const attempt = async (): Promise<string> => {
    const live = await deps.getSession();
    if (live) {
      await remember(live);
      return live.userId;
    }

    // No session on disk. Before writing this player off as new, ask the
    // keychain — after a reinstall this is the only thread back to their stuff.
    let stashed: string | null = null;
    try {
      stashed = await deps.readStash();
    } catch {
      stashed = null;
    }
    if (stashed) {
      let recovered: IdentitySession | null = null;
      try {
        recovered = await deps.refreshSession(stashed);
      } catch {
        // Revoked, expired, or offline. Offline is the painful one — it turns a
        // recoverable player into a new guest — but a stalled launch with no way
        // to play is worse, and the stash is left in place so a later launch on
        // a working connection can still find its way home.
        recovered = null;
      }
      if (recovered) {
        await remember(recovered);
        return recovered.userId;
      }
    }

    const created = await deps.signInAnonymously();
    await remember(created);
    return created.userId;
  };

  return {
    ensureSignedIn: () => {
      if (inFlight) return inFlight;
      const run = attempt().finally(() => {
        if (inFlight === run) inFlight = null;
      });
      inFlight = run;
      return run;
    },

    rememberSession: remember,

    forgetIdentity: async () => {
      inFlight = null;
      try {
        await deps.clearStash();
      } catch {
        // Nothing to do — worst case the old token outlives the sign-out.
      }
    },
  };
}

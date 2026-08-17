/**
 * Guest identity: the one thing a player can never be allowed to lose.
 *
 * Every coin, gem, cosmetic and streak is keyed to an anonymous auth user whose
 * only proof of ownership lives on the device. Two failures were observed in
 * production and are pinned here:
 *
 *  1. A session-less cold start called signInAnonymously() once per concurrent
 *     caller — App.tsx, the friends/presence/profile syncs and each store's
 *     refresh all race — minting 4-5 auth users in the same second. One session
 *     won storage; the rest became orphans that still took real writes (one paid
 *     a 100-coin quick-match stake and was then abandoned).
 *  2. Losing AsyncStorage (reinstall, or a new build's fresh container) silently
 *     minted a BRAND-NEW guest, so the player came back to zero cosmetics and a
 *     reset streak while their real account sat intact on the server.
 */

import { describe, it, expect, vi } from "vitest";
import { createIdentity, type IdentityDeps } from "../src/lib/identity";

/** A deps set with no session and an empty keychain, unless overridden. */
function deps(over: Partial<IdentityDeps> = {}) {
  let stash: string | null = null;
  const base: IdentityDeps = {
    getSession: vi.fn(async () => null),
    refreshSession: vi.fn(async () => null),
    signInAnonymously: vi.fn(async () => ({ userId: "new-guest", refreshToken: "rt-new" })),
    readStash: vi.fn(async () => stash),
    writeStash: vi.fn(async (t: string) => {
      stash = t;
    }),
    clearStash: vi.fn(async () => {
      stash = null;
    }),
    ...over,
  };
  return base;
}

describe("ensureSignedIn", () => {
  it("creates exactly one guest when callers race on a session-less start", async () => {
    const d = deps();
    const { ensureSignedIn } = createIdentity(d);

    const ids = await Promise.all([
      ensureSignedIn(),
      ensureSignedIn(),
      ensureSignedIn(),
      ensureSignedIn(),
      ensureSignedIn(),
    ]);

    expect(d.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(new Set(ids)).toEqual(new Set(["new-guest"]));
  });

  it("returns the live session without minting anything", async () => {
    const d = deps({
      getSession: vi.fn(async () => ({ userId: "me", refreshToken: "rt-live" })),
    });
    const { ensureSignedIn } = createIdentity(d);

    expect(await ensureSignedIn()).toBe("me");
    expect(d.signInAnonymously).not.toHaveBeenCalled();
    // Every session seen keeps the keychain copy current, so the token that
    // survives an uninstall is the one the server still accepts.
    expect(d.writeStash).toHaveBeenCalledWith("rt-live");
  });

  it("recovers the SAME account from the keychain after storage is wiped", async () => {
    const d = deps({
      readStash: vi.fn(async () => "rt-stashed"),
      refreshSession: vi.fn(async () => ({ userId: "me", refreshToken: "rt-rotated" })),
    });
    const { ensureSignedIn } = createIdentity(d);

    expect(await ensureSignedIn()).toBe("me");
    expect(d.refreshSession).toHaveBeenCalledWith("rt-stashed");
    expect(d.signInAnonymously).not.toHaveBeenCalled();
    // The rotated token replaces the spent one, or the next wipe can't recover.
    expect(d.writeStash).toHaveBeenCalledWith("rt-rotated");
  });

  it("falls back to a new guest when the stashed token is dead", async () => {
    const d = deps({
      readStash: vi.fn(async () => "rt-revoked"),
      refreshSession: vi.fn(async () => null),
    });
    const { ensureSignedIn } = createIdentity(d);

    expect(await ensureSignedIn()).toBe("new-guest");
    expect(d.writeStash).toHaveBeenCalledWith("rt-new");
  });

  it("does not wedge: a failed attempt is retried by the next caller", async () => {
    const signInAnonymously = vi
      .fn<IdentityDeps["signInAnonymously"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ userId: "new-guest", refreshToken: "rt-new" });
    const d = deps({ signInAnonymously });
    const { ensureSignedIn } = createIdentity(d);

    await expect(ensureSignedIn()).rejects.toThrow("offline");
    expect(await ensureSignedIn()).toBe("new-guest");
  });

  it("forgetting an identity clears the keychain so it cannot be recovered", async () => {
    const d = deps({ readStash: vi.fn(async () => "rt-old") });
    const { forgetIdentity, ensureSignedIn } = createIdentity(d);

    await forgetIdentity();
    expect(d.clearStash).toHaveBeenCalled();
    // A deliberate sign-out must land on a fresh guest, not resurrect the old one.
    expect(await ensureSignedIn()).toBe("new-guest");
  });
});

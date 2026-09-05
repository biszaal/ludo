/**
 * A name the index refuses must not cost the player their whole profile row.
 *
 * `profiles.display_name` is NOT NULL (0003), so when no row exists yet a name
 * another account already holds does not merely fail to save — it takes the
 * entire INSERT with it. The account is then left with no profile at all:
 * invisible to opponents (they see a bare colour label), unfindable by friends,
 * and permanently so, because every later sync retries the same refused name.
 *
 * That is the state found in production on 2026-09-05 — an Apple account with
 * 49,925 coins, no profiles row, displaying a username registered to a Google
 * account on the same device. lib/profileCarry stops the stale name arriving in
 * the first place; these pin what happens when a genuine collision occurs
 * anyway, which it will whenever two people want the same handle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertMyProfile = vi.fn();
vi.mock("../src/net/api", () => ({ upsertMyProfile: (...a: unknown[]) => upsertMyProfile(...a) }));

import { claimName, pushProfile } from "../src/net/profileSync";
import { useProfile } from "../src/store/profileStore";

const GUEST = "guest481920";

beforeEach(() => {
  upsertMyProfile.mockReset();
  useProfile.setState({ displayName: "Bishal", guestName: GUEST, avatarId: "orbit-moss", diceSkinId: "classic" });
});

describe("a refused name still leaves the account with a profile", () => {
  it("falls back to this device's guest handle so the row gets written", () => {
    upsertMyProfile
      .mockResolvedValueOnce({ conflict: true })
      .mockResolvedValueOnce({ displayName: GUEST, diceSkin: null, nameChangedAt: null });

    return pushProfile("Bishal", "orbit-moss", "classic").then(() => {
      expect(upsertMyProfile).toHaveBeenCalledTimes(2);
      // The retry writes the handle, which nobody else can be holding.
      expect(upsertMyProfile.mock.calls[1]![0]).toBe(GUEST);
      // And the UI stops claiming a name the account does not own.
      expect(useProfile.getState().displayName).toBe(GUEST);
    });
  });

  it("does not retry when the handle itself was the name that conflicted", async () => {
    // Guards the obvious infinite-retry shape: pushing the guest handle, being
    // refused, and pushing the guest handle again.
    useProfile.setState({ displayName: GUEST });
    upsertMyProfile.mockResolvedValue({ conflict: true });

    await pushProfile(GUEST, "orbit-moss", "classic");

    expect(upsertMyProfile).toHaveBeenCalledTimes(1);
  });

  it("leaves the local name alone when offline, rather than demoting it", async () => {
    // Null is "try again later", not "you cannot have this name".
    upsertMyProfile.mockResolvedValue(null);

    await pushProfile("Bishal", "orbit-moss", "classic");

    expect(useProfile.getState().displayName).toBe("Bishal");
  });
});

describe("claimName tells the player the truth about a collision", () => {
  it("reports a refused name as taken, not as a connection problem", async () => {
    // With no row yet the index refuses outright, which used to surface as
    // "offline" — telling someone to check their signal about a name another
    // player simply holds.
    upsertMyProfile.mockResolvedValue({ conflict: true });

    expect(await claimName("Bishal")).toBe("taken");
    // The field keeps what they typed so they can edit rather than retype it.
    expect(useProfile.getState().displayName).toBe("Bishal");
  });

  it("still reports a real network failure as offline", async () => {
    upsertMyProfile.mockResolvedValue(null);
    expect(await claimName("Bishal")).toBe("offline");
  });
});

/**
 * The first-run name prompt is asked once, and never of an existing player.
 *
 * Two things carry real risk here and neither is visible on screen.
 *
 * The migration: `namePromptSeen` did not exist in v2, so every install already
 * out there deserialises without it. Defaulting to false would greet a player
 * mid-way through a coin streak with an onboarding screen on their next update.
 * v3 has to write `true` for anyone who already has a stored profile.
 *
 * The claim: names are unique-indexed and the server keeps the EXISTING row
 * rather than raising, so a taken name comes back as a silently different
 * string. Read as success, that snaps the field to `guest481920` with no
 * explanation — which is precisely the failure the prompt exists to avoid.
 *
 * And the reinstall, added later: the migration above only protects a device
 * whose stored profile survived. AsyncStorage goes with the app, so after a
 * reinstall `namePromptSeen` is false and a fresh guest handle has been minted
 * — while the keychain restores the player's real, email-linked account
 * underneath it (lib/identity). The device looks brand new and the account is
 * anything but, and the player was met with "What should we call you?" over a
 * name they registered months ago.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertMyProfile = vi.fn();
vi.mock("../src/net/api", () => ({ upsertMyProfile: (...a: unknown[]) => upsertMyProfile(...a) }));

import { askForName } from "../src/lib/namePrompt";
import { claimName } from "../src/net/profileSync";
import { useProfile } from "../src/store/profileStore";

beforeEach(() => {
  upsertMyProfile.mockReset();
  useProfile.setState({ displayName: "guest481920", guestName: "guest481920", namePromptSeen: false });
});

describe("claimName", () => {
  it("adopts the name when the server keeps it", async () => {
    upsertMyProfile.mockResolvedValue({ displayName: "Bishal", diceSkin: null });
    expect(await claimName("Bishal")).toBe("ok");
    expect(useProfile.getState().displayName).toBe("Bishal");
  });

  it("reports a name the server gave to someone else, and leaves the local one alone", async () => {
    // The unique index kept the incumbent row, so the server answers with the
    // name we already had rather than the one we asked for.
    upsertMyProfile.mockResolvedValue({ displayName: "guest481920", diceSkin: null });
    expect(await claimName("Bishal")).toBe("taken");
    expect(useProfile.getState().displayName).toBe("guest481920");
  });

  it("treats a capitalisation the DB accepted as success, not as taken", async () => {
    upsertMyProfile.mockResolvedValue({ displayName: "bishal", diceSkin: null });
    expect(await claimName("Bishal")).toBe("ok");
    expect(useProfile.getState().displayName).toBe("bishal");
  });

  it("does not hold the player at the screen when the write cannot happen", async () => {
    upsertMyProfile.mockResolvedValue(null);
    expect(await claimName("Bishal")).toBe("offline");
  });

  it("treats a thrown request as offline rather than letting it escape", async () => {
    upsertMyProfile.mockRejectedValue(new Error("network"));
    expect(await claimName("Bishal")).toBe("offline");
  });
});

describe("the prompt is one-time", () => {
  it("marks itself seen so it never asks twice", () => {
    useProfile.getState().markNamePromptSeen();
    expect(useProfile.getState().namePromptSeen).toBe(true);
  });

  it("never greets an existing install: v2 profiles migrate to seen", async () => {
    // Reach the persist migration the way zustand does, through the options.
    const persist = (useProfile as unknown as {
      persist: { getOptions: () => { migrate?: (s: unknown, v: number) => unknown } };
    }).persist;
    const migrate = persist.getOptions().migrate;
    expect(migrate).toBeTypeOf("function");

    const v2 = { displayName: "Bishal", guestName: "guest481920", avatarId: "orbit-moss", diceSkinId: "classic" };
    const migrated = migrate!(v2, 2) as { namePromptSeen: boolean; displayName: string };
    expect(migrated.namePromptSeen).toBe(true);
    expect(migrated.displayName).toBe("Bishal");
  });

  it("still asks a genuinely fresh install", () => {
    // No stored state at all: the store's own default stands.
    expect(useProfile.getInitialState().namePromptSeen).toBe(false);
  });
});

describe("askForName", () => {
  it("asks a new guest who has never been asked", () => {
    expect(askForName({ promptSeen: false, isGuest: true })).toBe(true);
  });

  it("never asks a saved account, however new this device is", () => {
    // The reinstall: nothing on this device has been asked anything, and the
    // account behind it already holds a registered name.
    expect(askForName({ promptSeen: false, isGuest: false })).toBe(false);
  });

  it("waits rather than guessing while the session is still being read", () => {
    // Guessing "guest" here is how the prompt flashes over the hub and vanishes
    // a frame later on every reinstall.
    expect(askForName({ promptSeen: false, isGuest: null })).toBe(false);
  });

  it("stays a one-time question once it has been answered", () => {
    expect(askForName({ promptSeen: true, isGuest: true })).toBe(false);
  });
});

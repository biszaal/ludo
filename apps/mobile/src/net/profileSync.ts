/**
 * Keeps the Supabase profiles row in step with the local profile store —
 * debounced on edits (typing in the name field) and best-effort: profile sync
 * must never block or break play. Initial sync after sign-in happens in
 * onlineStore's create/join. Import this only from App.tsx.
 */

import { useProfile } from "../store/profileStore";
import { upsertMyProfile } from "./api";

const DEBOUNCE_MS = 1200;

/**
 * Push the profile, then adopt whatever the server kept.
 *
 * Two fields the server may overrule: the dice skin (it strips a priced skin
 * you don't own) and the display name (a name registered to someone else loses
 * to the unique index, and a SECOND username change is reverted by 0030's
 * trigger). Taking its answer back is what keeps "what I see" and "what my
 * opponents see" the same object — the alternative is an identity that looks
 * right forever on this device and nowhere else.
 */
export async function pushProfile(displayName: string, avatarId: string, diceSkinId: string): Promise<void> {
  const stored = await upsertMyProfile(displayName, avatarId, diceSkinId);
  if (!stored) return; // offline or signed out — try again on the next edit
  const wanted = diceSkinId === "classic" ? null : diceSkinId;
  if (stored.diceSkin !== wanted) {
    useProfile.getState().setDiceSkin(stored.diceSkin ?? "classic");
  }
  // Only correct a genuine divergence. Comparing case-sensitively would fight
  // the user over a capitalisation the DB accepted verbatim.
  if (stored.displayName && stored.displayName !== useProfile.getState().displayName) {
    useProfile.getState().setName(stored.displayName);
  }
}

export function initProfileSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsub = useProfile.subscribe((s, prev) => {
    if (s.displayName === prev.displayName && s.avatarId === prev.avatarId && s.diceSkinId === prev.diceSkinId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void pushProfile(s.displayName, s.avatarId, s.diceSkinId).catch(() => {});
    }, DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}

/** What happened to a name the player asked for. */
export type NameClaim = "ok" | "taken" | "offline";

/**
 * Claim a display name and report whether it actually stuck.
 *
 * pushProfile above adopts whatever the server kept and says nothing, which is
 * right for a debounced edit in a settings field — the name simply settles. It
 * is wrong for a screen that ASKED a direct question: typing a name someone
 * else already holds would snap the field back to `guest481920` with no
 * explanation at all.
 *
 * Names are unique-indexed (0006) and the server keeps the existing row rather
 * than raising, so "taken" is not an error to catch — it is the returned name
 * differing from the one we sent. Compared case-insensitively, for the same
 * reason pushProfile does: the DB accepts a capitalisation verbatim, and
 * fighting the player over it would report a successful claim as a failure.
 *
 * "offline" is not a refusal. Nothing is written, the local name still changes,
 * and initProfileSync's subscription pushes it on the next connection — the
 * player is not held at an onboarding screen because their train went into a
 * tunnel.
 */
export async function claimName(name: string): Promise<NameClaim> {
  const stored = await upsertMyProfile(name, useProfile.getState().avatarId, useProfile.getState().diceSkinId).catch(
    () => null,
  );
  if (!stored) return "offline";
  if (stored.displayName && stored.displayName.toLowerCase() !== name.toLowerCase()) {
    // Someone else holds it. Leave the local store alone so the field keeps
    // what was typed and the player can edit it rather than retype it.
    return "taken";
  }
  useProfile.getState().setName(stored.displayName ?? name);
  return "ok";
}

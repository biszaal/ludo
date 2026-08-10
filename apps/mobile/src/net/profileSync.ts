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

/**
 * Keeps the Supabase profiles row in step with the local profile store —
 * debounced on edits (typing in the name field) and best-effort: profile sync
 * must never block or break play. Initial sync after sign-in happens in
 * onlineStore's create/join. Import this only from App.tsx.
 */

import { useProfile } from "../store/profileStore";
import { upsertMyProfile } from "./api";

const DEBOUNCE_MS = 1200;

export function initProfileSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsub = useProfile.subscribe((s, prev) => {
    if (s.displayName === prev.displayName && s.avatarId === prev.avatarId) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void upsertMyProfile(s.displayName, s.avatarId).catch(() => {});
    }, DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}

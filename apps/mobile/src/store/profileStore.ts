/**
 * Local player identity — display name, avatar and dice skin, persisted on
 * device. Used for local games and (from the online milestone) synced to the
 * Supabase profiles table so friends see it in the lobby — and, for the dice
 * skin, see it on the board whenever this player rolls.
 *
 * Every device mints a random guest handle ("guest362829") once and falls back
 * to it whenever no name is set — never a placeholder like "You", which used to
 * sync to the server and label every seat "You" on everyone's screen.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";

export const MAX_NAME_LENGTH = 20;

export function makeGuestName(): string {
  return `guest${Math.floor(100000 + Math.random() * 900000)}`;
}

interface ProfileState {
  displayName: string;
  /** This device's permanent fallback identity, minted on first launch. */
  guestName: string;
  avatarId: string;
  /** Equipped dice skin id; "classic" inherits the board theme and needs no
   *  entitlement. Synced to profiles.dice_skin the same way avatarId is. */
  diceSkinId: string;
  setName: (name: string) => void;
  setAvatar: (id: string) => void;
  setDiceSkin: (id: string) => void;
}

const initialGuestName = makeGuestName();

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      displayName: initialGuestName,
      guestName: initialGuestName,
      avatarId: "orbit-moss",
      diceSkinId: "classic",
      setName: (name) => {
        const trimmed = name.slice(0, MAX_NAME_LENGTH);
        set({ displayName: trimmed.trim().length === 0 ? get().guestName : trimmed });
      },
      setAvatar: (id) => set({ avatarId: id }),
      setDiceSkin: (id) => set({ diceSkinId: id }),
    }),
    {
      name: "ludo-profile",
      version: 2,
      storage: createJSONStorage(kvStorage),
      // v1 had no guestName and defaulted displayName to the literal "You".
      migrate: (persisted, version) => {
        const p = persisted as Partial<ProfileState>;
        if (version < 2) {
          const guestName = makeGuestName();
          const unnamed = !p.displayName || p.displayName.trim().length === 0 || p.displayName === "You";
          return { ...p, guestName, displayName: unnamed ? guestName : p.displayName };
        }
        return p as ProfileState;
      },
    },
  ),
);

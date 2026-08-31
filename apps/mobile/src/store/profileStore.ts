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
  /**
   * Has this device been offered the first-run name prompt yet?
   *
   * Set by ChooseNameScreen whether the player names themselves OR skips, so
   * the prompt is a one-time thing and never nags. Existing installs are
   * migrated to `true` — someone already playing must not be stopped by an
   * onboarding screen on their next update.
   */
  namePromptSeen: boolean;
  setName: (name: string) => void;
  markNamePromptSeen: () => void;
  setAvatar: (id: string) => void;
  setDiceSkin: (id: string) => void;
}

const initialGuestName = makeGuestName();

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      displayName: initialGuestName,
      guestName: initialGuestName,
      namePromptSeen: false,
      avatarId: "orbit-moss",
      diceSkinId: "classic",
      setName: (name) => {
        const trimmed = name.slice(0, MAX_NAME_LENGTH);
        set({ displayName: trimmed.trim().length === 0 ? get().guestName : trimmed });
      },
      markNamePromptSeen: () => set({ namePromptSeen: true }),
      setAvatar: (id) => set({ avatarId: id }),
      setDiceSkin: (id) => set({ diceSkinId: id }),
    }),
    {
      name: "ludo-profile",
      version: 3,
      storage: createJSONStorage(kvStorage),
      // v1 had no guestName and defaulted displayName to the literal "You".
      // v2 had no namePromptSeen: anyone with a stored profile is an EXISTING
      // player, and the first-run prompt must not appear on their next update.
      migrate: (persisted, version) => {
        let p = persisted as Partial<ProfileState>;
        if (version < 2) {
          const guestName = makeGuestName();
          const unnamed = !p.displayName || p.displayName.trim().length === 0 || p.displayName === "You";
          p = { ...p, guestName, displayName: unnamed ? guestName : p.displayName };
        }
        if (version < 3) p = { ...p, namePromptSeen: true };
        return p as ProfileState;
      },
    },
  ),
);

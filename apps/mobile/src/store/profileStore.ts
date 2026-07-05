/**
 * Local player identity — display name + avatar, persisted on device. Used for
 * local games and (from the online milestone) synced to the Supabase profiles
 * table so friends see it in the lobby.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { kvStorage } from "../lib/storage";

export const MAX_NAME_LENGTH = 20;

interface ProfileState {
  displayName: string;
  avatarId: string;
  setName: (name: string) => void;
  setAvatar: (id: string) => void;
}

export const useProfile = create<ProfileState>()(
  persist(
    (set) => ({
      displayName: "You",
      avatarId: "orbit-moss",
      setName: (name) => {
        const trimmed = name.slice(0, MAX_NAME_LENGTH);
        set({ displayName: trimmed.trim().length === 0 ? "You" : trimmed });
      },
      setAvatar: (id) => set({ avatarId: id }),
    }),
    {
      name: "ludo-profile",
      version: 1,
      storage: createJSONStorage(kvStorage),
    },
  ),
);

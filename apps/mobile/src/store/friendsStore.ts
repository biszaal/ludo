/**
 * Friends + incoming room invites. Holds the caller's friendship rows (both
 * directions), the display profiles for those users, and any pending room
 * invites. Subscribes to realtime so requests/acceptances/invites arrive live.
 *
 * Native-importing (supabase) — imported from screens and App, never from the
 * Node test suite. The relationship logic is factored into src/lib/friendship
 * so it stays unit-testable.
 */

import { create } from "zustand";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as friends from "../net/friends";
import { ensureSignedIn, getProfiles, type Profile } from "../net/api";
import { relationshipTo, type Relationship } from "../lib/friendship";
import { useOnlineStore } from "./onlineStore";
import { playSound } from "../lib/sound";

interface FriendsStore {
  ready: boolean;
  userId: string | null;
  friendships: friends.Friendship[];
  invites: friends.RoomInvite[];
  /** Display profiles keyed by auth user_id (names/avatars for friends). */
  profiles: Record<string, Profile>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  inviteToRoom: (userId: string, roomCode: string) => Promise<void>;
  /** Accept an invite: join the room and clear the invite. */
  acceptInvite: (invite: friends.RoomInvite) => Promise<void>;
  dismissInvite: (id: string) => Promise<void>;

  relationshipTo: (userId: string) => Relationship;
}

let channel: RealtimeChannel | null = null;

export const useFriends = create<FriendsStore>((set, get) => ({
  ready: false,
  userId: null,
  friendships: [],
  invites: [],
  profiles: {},

  init: async () => {
    if (get().ready) return;
    let userId: string;
    try {
      userId = await ensureSignedIn();
    } catch {
      return; // not signed in yet — a later create/join/init will retry
    }
    set({ userId, ready: true });
    await get().refresh();
    channel = friends.subscribeFriendEvents(userId, {
      onFriendships: () => void get().refresh(),
      onInvite: () => void refreshInvitesWithChime(get, set),
    });
  },

  refresh: async () => {
    const [friendships, invites] = await Promise.all([friends.listFriendships(), friends.listMyInvites()]);
    set({ friendships, invites });
    await mergeProfiles(get, set, friendships, invites);
  },

  sendRequest: async (userId) => {
    await friends.sendFriendRequest(userId);
    await get().refresh();
  },

  accept: async (id) => {
    await friends.acceptFriendRequest(id);
    await get().refresh();
  },

  remove: async (id) => {
    await friends.removeFriendship(id);
    set({ friendships: get().friendships.filter((f) => f.id !== id) });
  },

  inviteToRoom: async (userId, roomCode) => {
    await friends.sendRoomInvite(userId, roomCode);
  },

  acceptInvite: async (invite) => {
    set({ invites: get().invites.filter((i) => i.id !== invite.id) });
    void friends.clearInvite(invite.id);
    await useOnlineStore.getState().join(invite.room_code);
  },

  dismissInvite: async (id) => {
    set({ invites: get().invites.filter((i) => i.id !== id) });
    void friends.clearInvite(id);
  },

  relationshipTo: (userId) => relationshipTo(get().friendships, get().userId, userId),
}));

async function mergeProfiles(
  get: () => FriendsStore,
  set: (partial: Partial<FriendsStore>) => void,
  friendships: friends.Friendship[],
  invites: friends.RoomInvite[],
): Promise<void> {
  const me = get().userId;
  const ids = new Set<string>();
  for (const f of friendships) {
    ids.add(f.requester_user_id);
    ids.add(f.addressee_user_id);
  }
  for (const i of invites) ids.add(i.from_user_id);
  if (me) ids.delete(me);
  if (ids.size === 0) return;
  const rows = await getProfiles([...ids]);
  if (rows.length === 0) return;
  const profiles = { ...get().profiles };
  for (const r of rows) profiles[r.user_id] = r;
  set({ profiles });
}

/** A new invite arrived via realtime — reload and chime softly. */
async function refreshInvitesWithChime(
  get: () => FriendsStore,
  set: (partial: Partial<FriendsStore>) => void,
): Promise<void> {
  const before = get().invites.length;
  const invites = await friends.listMyInvites();
  set({ invites });
  await mergeProfiles(get, set, get().friendships, invites);
  if (invites.length > before) playSound("ding");
}

/** Subscribe the friends store at app start. Returns an unsubscribe. */
export function initFriends(): () => void {
  void useFriends.getState().init();
  return () => {
    if (channel) {
      channel.unsubscribe();
      channel = null;
    }
  };
}

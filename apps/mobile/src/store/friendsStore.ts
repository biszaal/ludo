/**
 * Friends, discovery, presence and incoming room invites. Holds the caller's
 * friendship rows (both directions), the display profiles and public records
 * for those users, who is online, and any pending room invites. Subscribes to
 * realtime so requests/acceptances/invites arrive live.
 *
 * Native-importing (supabase) — imported from screens and App, never from the
 * Node test suite. The relationship, presence and formatting logic is factored
 * into src/lib/friendship so it stays unit-testable.
 *
 * Notification policy: an incoming friend request chimes softly and bumps a
 * badge. It deliberately does NOT raise a banner — that surface is reserved for
 * room invites, where the sender is waiting and latency actually matters.
 */

import { create } from "zustand";
import { AppState, type AppStateStatus } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as friends from "../net/friends";
import {
  ensureSignedIn,
  getMyFriendCode,
  getPlayerStats,
  getProfiles,
  getRecentPlayers,
  requestFriend,
  type Profile,
  type PublicStats,
} from "../net/api";
import { incomingRequests, relationshipTo, type Relationship } from "../lib/friendship";
import { useOnlineStore } from "./onlineStore";
import { useNav } from "./navStore";
import { playSound } from "../lib/sound";

/** Heartbeat cadence. The 0017 TTL is 90s, so this tolerates one missed beat. */
const HEARTBEAT_MS = 60_000;
/** How often the friends screen re-reads everyone's dot while it's focused. */
const PRESENCE_POLL_MS = 30_000;

interface FriendsStore {
  ready: boolean;
  userId: string | null;
  friendships: friends.Friendship[];
  invites: friends.RoomInvite[];
  /** Display profiles keyed by auth user_id (names/avatars for friends). */
  profiles: Record<string, Profile>;
  /** Public match record keyed by auth user_id. */
  stats: Record<string, PublicStats>;
  /** Last-seen epoch ms keyed by auth user_id; 0 means explicitly offline. */
  presence: Record<string, number>;
  /** The caller's own shareable code, loaded lazily by the Add Friend screen. */
  myCode: string | null;
  /** Past opponents who aren't already friends (bots already filtered out). */
  recentPlayers: Profile[];
  /** Who PlayerProfileScreen is showing. Nav takes no params by design (only
   *  the top entry mounts, so screen state lives in stores) — this is it. */
  viewingUserId: string | null;

  /** Open a player's public profile: caches their card, then navigates. */
  viewPlayer: (userId: string) => Promise<void>;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshPresence: () => Promise<void>;
  loadMyCode: () => Promise<void>;
  loadRecentPlayers: () => Promise<void>;
  sendRequest: (userId: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  block: (userId: string) => Promise<void>;
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
  stats: {},
  presence: {},
  myCode: null,
  recentPlayers: [],
  viewingUserId: null,

  viewPlayer: async (userId) => {
    set({ viewingUserId: userId });
    useNav.getState().push("playerProfile");
    // A player reached by friend code is a stranger — not in the profile cache,
    // which only covers friends and invite senders. Fetch before the card reads
    // it, otherwise their name renders as the "Ludo player" fallback.
    const known = !!get().profiles[userId];
    await Promise.all([
      mergeStats(get, set, [userId]),
      known
        ? Promise.resolve()
        : getProfiles([userId]).then((rows) => {
            if (rows.length > 0) set({ profiles: { ...get().profiles, [rows[0]!.user_id]: rows[0]! } });
          }),
    ]);
  },

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
      onFriendships: () => void refreshFriendshipsWithChime(get),
      onInvite: () => void refreshInvitesWithChime(get, set),
    });
  },

  refresh: async () => {
    const [friendships, invites] = await Promise.all([friends.listFriendships(), friends.listMyInvites()]);
    set({ friendships, invites });
    await mergeProfiles(get, set, friendships, invites);
  },

  refreshPresence: async () => {
    const presence = await friends.getPresence();
    set({ presence });
  },

  loadMyCode: async () => {
    if (get().myCode) return;
    const code = await getMyFriendCode();
    if (code) set({ myCode: code });
  },

  loadRecentPlayers: async () => {
    const players = await getRecentPlayers();
    set({ recentPlayers: players });
    if (players.length > 0) await mergeStats(get, set, players.map((p) => p.user_id));
  },

  sendRequest: async (userId) => {
    // Through the edge function, not the table: it enforces blocks and rate
    // limits with readable errors, and sets the bot auto-decline delay.
    await requestFriend(userId);
    await get().refresh();
    // A sent request means they're no longer a "recent player" suggestion.
    set({ recentPlayers: get().recentPlayers.filter((p) => p.user_id !== userId) });
  },

  accept: async (id) => {
    await friends.acceptFriendRequest(id);
    await get().refresh();
  },

  remove: async (id) => {
    await friends.removeFriendship(id);
    set({ friendships: get().friendships.filter((f) => f.id !== id) });
  },

  block: async (userId) => {
    await friends.blockUser(userId);
    // The 0015 cascade removes the rows server-side; drop them locally now so
    // the UI doesn't show a stale friend until realtime catches up.
    set({
      friendships: get().friendships.filter(
        (f) => f.requester_user_id !== userId && f.addressee_user_id !== userId,
      ),
      recentPlayers: get().recentPlayers.filter((p) => p.user_id !== userId),
    });
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

/** Public records for a set of users, merged into the cache. Best-effort. */
async function mergeStats(
  get: () => FriendsStore,
  set: (partial: Partial<FriendsStore>) => void,
  userIds: string[],
): Promise<void> {
  const rows = await getPlayerStats(userIds);
  if (Object.keys(rows).length === 0) return;
  set({ stats: { ...get().stats, ...rows } });
}

/** A friendship row changed via realtime — reload, and chime only when a NEW
 *  request actually arrived (acceptances and removals fire this too). */
async function refreshFriendshipsWithChime(get: () => FriendsStore): Promise<void> {
  const me = get().userId;
  const before = incomingRequests(get().friendships, me).length;
  await get().refresh();
  const after = incomingRequests(get().friendships, me).length;
  if (after > before) playSound("ding");
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

/**
 * Keep our own presence row warm while the app is foregrounded, and mark us
 * away the moment it isn't. Backgrounding is written explicitly rather than
 * waiting for the TTL, so a friend's dot goes grey immediately instead of
 * lingering for a minute and a half. Returns an unsubscribe.
 */
export function initPresence(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const start = () => {
    if (timer) return;
    void friends.heartbeat();
    timer = setInterval(() => void friends.heartbeat(), HEARTBEAT_MS);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const onChange = (next: AppStateStatus) => {
    if (next === "active") {
      start();
    } else {
      stop();
      void friends.markOffline();
    }
  };

  if (AppState.currentState === "active") start();
  const sub = AppState.addEventListener("change", onChange);

  return () => {
    stop();
    sub.remove();
    void friends.markOffline();
  };
}

/** Poll everyone's dot while a screen that shows them is mounted. Returns an
 *  unsubscribe; safe to call from a useEffect. */
export function pollPresence(): () => void {
  void useFriends.getState().refreshPresence();
  const timer = setInterval(() => void useFriends.getState().refreshPresence(), PRESENCE_POLL_MS);
  return () => clearInterval(timer);
}

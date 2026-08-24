/**
 * Friends + room invites network layer. Direct table access gated by RLS
 * (0005_friends.sql, 0015, 0017). All writes are best-effort from the caller's
 * session; reads are scoped to rows the caller is party to.
 *
 * The split, since it isn't uniform: accepting, declining, cancelling,
 * unfriending, inviting, blocking and presence all live here, because RLS can
 * express each one exactly. DISCOVERY does not — resolving a friend code reads
 * a row you're not party to, and "recently played with" has to subtract hidden
 * bots (0009) that clients cannot see at all. Those four ops go through the
 * game edge function; their wrappers live in net/api.ts next to callGame.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";
import { announceOnlineOp, ensureSignedIn, inviteToRoomOp } from "./api";

export interface Friendship {
  id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: "pending" | "accepted";
  created_at: string;
}

export interface RoomInvite {
  id: string;
  from_user_id: string;
  to_user_id: string;
  room_code: string;
  /** Per-seat pot at invite time, for display. 0 = friendly game. */
  stake: number;
  created_at: string;
}

/** All friendship rows the caller is party to (both directions, any status). */
export async function listFriendships(): Promise<Friendship[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("friendships")
    .select("id, requester_user_id, addressee_user_id, status, created_at")
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as Friendship[];
}

/** Send a friend request to a user you've met (e.g. an opponent). */
export async function sendFriendRequest(toUserId: string): Promise<void> {
  const me = await ensureSignedIn();
  if (toUserId === me) return;
  const supabase = getSupabase();
  // If they already sent me one, accept it instead of creating a reverse dupe.
  const { data: reverse } = await supabase
    .from("friendships")
    .select("id, status")
    .eq("requester_user_id", toUserId)
    .eq("addressee_user_id", me)
    .maybeSingle();
  if (reverse) {
    if (reverse.status === "pending") await acceptFriendRequest(reverse.id);
    return;
  }
  await supabase
    .from("friendships")
    .upsert({ requester_user_id: me, addressee_user_id: toUserId, status: "pending" }, { onConflict: "requester_user_id,addressee_user_id" });
}

export async function acceptFriendRequest(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
}

/** Decline a request, cancel one you sent, or unfriend — all a row delete. */
export async function removeFriendship(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("friendships").delete().eq("id", id);
}

/** Ping a friend to come join a room. The stake rides along so the banner can
 *  say what the game is worth before they commit.
 *
 *  Goes through the edge function rather than straight to the table: only the
 *  server can reach Expo and actually push this, and an invite that arrives
 *  solely over realtime is one that only reaches people already looking at the
 *  app. The 0015 insert policy still stands as the backstop. */
export async function sendRoomInvite(toUserId: string, roomCode: string, stake = 0): Promise<void> {
  await inviteToRoomOp(toUserId, roomCode, stake);
}

export async function listMyInvites(): Promise<RoomInvite[]> {
  const me = await ensureSignedIn();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_invites")
    .select("id, from_user_id, to_user_id, room_code, stake, created_at")
    .eq("to_user_id", me)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as RoomInvite[];
}

export async function clearInvite(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("room_invites").delete().eq("id", id);
}

/** Block someone: severs the friendship and any pending invites both ways via
 *  the 0015 cascade trigger, and stops them re-requesting. */
export async function blockUser(userId: string): Promise<void> {
  const me = await ensureSignedIn();
  if (userId === me) return;
  const supabase = getSupabase();
  await supabase.from("blocks").insert({ blocker_user_id: me, blocked_user_id: userId });
}

// --- Presence ---------------------------------------------------------------
// A heartbeat row per user (0017), not a realtime channel: one query reads all
// N friends' dots with zero extra subscriptions. See the migration header.

/** Touch our own presence row. Called on a 60s heartbeat while foregrounded. */
export async function heartbeat(): Promise<void> {
  const me = await ensureSignedIn();
  const supabase = getSupabase();
  await supabase
    .from("user_presence")
    .upsert({ user_id: me, last_seen_at: new Date().toISOString(), status: "online" }, { onConflict: "user_id" });
}

/**
 * The session's FIRST heartbeat, routed through the edge function so it can
 * also notify friends that we're back (opPresenceOnline).
 *
 * Falls back to the plain heartbeat if that call fails. Presence is the part
 * that has to work — a grey dot on a player who is sitting right there is a
 * visible bug, whereas a missed "your friend is online" is nothing at all.
 */
export async function announceOnline(): Promise<void> {
  try {
    await announceOnlineOp();
  } catch {
    await heartbeat().catch(() => {});
  }
}

/** Mark ourselves offline immediately (app backgrounded). The 90s TTL is only
 *  the fallback for a crash or a dropped connection. */
export async function markOffline(): Promise<void> {
  const me = await ensureSignedIn();
  const supabase = getSupabase();
  await supabase
    .from("user_presence")
    .upsert({ user_id: me, last_seen_at: new Date().toISOString(), status: "offline" }, { onConflict: "user_id" });
}

/**
 * Last-seen epoch ms for the given friends.
 *
 * RLS already scopes this table to accepted friends (0017), so asking for the
 * ids is redundant for CORRECTNESS — but not for cost. The policy runs an
 * EXISTS against `friendships` once per row it considers, so an unfiltered
 * select is O(every user who has ever been online) on a timer, per client. The
 * ids turn that into an index lookup, and having none at all means there is
 * nothing to ask.
 *
 * An explicit 'offline' status collapses to 0 so isOnline() reads it as away
 * regardless of how fresh the timestamp is.
 */
export async function getPresence(friendIds: string[]): Promise<Record<string, number>> {
  if (friendIds.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("user_presence")
    .select("user_id, last_seen_at, status")
    .in("user_id", friendIds);
  if (error) return {};
  const out: Record<string, number> = {};
  for (const r of data ?? []) {
    out[r.user_id as string] = r.status === "offline" ? 0 : Date.parse(r.last_seen_at as string);
  }
  return out;
}

export interface FriendEventHandlers {
  onFriendships: () => void;
  onInvite: () => void;
}

/** Subscribe to the caller's friendship + invite changes (both live-update). */
export function subscribeFriendEvents(userId: string, handlers: FriendEventHandlers): RealtimeChannel {
  const supabase = getSupabase();
  return supabase
    .channel(`friends:${userId}`)
    // Friendships where I'm the addressee (incoming requests / I accept).
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `addressee_user_id=eq.${userId}` }, () => handlers.onFriendships())
    // Friendships where I'm the requester (my request was accepted / removed).
    .on("postgres_changes", { event: "*", schema: "public", table: "friendships", filter: `requester_user_id=eq.${userId}` }, () => handlers.onFriendships())
    // Room invites addressed to me.
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_invites", filter: `to_user_id=eq.${userId}` }, () => handlers.onInvite())
    .subscribe();
}

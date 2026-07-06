/**
 * Friends + room invites network layer. Direct table access gated by RLS
 * (0005_friends.sql) — the edge function isn't involved. All writes are
 * best-effort from the caller's session; reads are scoped to rows the caller
 * is party to.
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";
import { ensureSignedIn } from "./api";

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

/** Ping a friend to come join a room. Best-effort. */
export async function sendRoomInvite(toUserId: string, roomCode: string): Promise<void> {
  const me = await ensureSignedIn();
  const supabase = getSupabase();
  await supabase.from("room_invites").insert({ from_user_id: me, to_user_id: toUserId, room_code: roomCode });
}

export async function listMyInvites(): Promise<RoomInvite[]> {
  const me = await ensureSignedIn();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("room_invites")
    .select("id, from_user_id, to_user_id, room_code, created_at")
    .eq("to_user_id", me)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as RoomInvite[];
}

export async function clearInvite(id: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("room_invites").delete().eq("id", id);
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

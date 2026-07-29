/**
 * Pure relationship logic over friendship rows — no store/native imports, so
 * the Node test suite can exercise it directly. A "friendship" is one directed
 * row (requester → addressee) that either party may see; accepting flips its
 * status. From the local user's viewpoint every other user is in exactly one
 * of these states.
 */

export interface FriendshipRow {
  id: string;
  requester_user_id: string;
  addressee_user_id: string;
  status: "pending" | "accepted";
}

export type Relationship =
  | { kind: "none" }
  | { kind: "friends"; id: string }
  | { kind: "outgoing"; id: string } // I requested them; awaiting their accept
  | { kind: "incoming"; id: string }; // they requested me; I can accept/decline

/** How the local user (`me`) currently relates to `other`. */
export function relationshipTo(rows: FriendshipRow[], me: string | null, other: string): Relationship {
  if (!me || me === other) return { kind: "none" };
  const row = rows.find(
    (r) =>
      (r.requester_user_id === me && r.addressee_user_id === other) ||
      (r.requester_user_id === other && r.addressee_user_id === me),
  );
  if (!row) return { kind: "none" };
  if (row.status === "accepted") return { kind: "friends", id: row.id };
  return row.requester_user_id === me ? { kind: "outgoing", id: row.id } : { kind: "incoming", id: row.id };
}

/** Accepted friends' user ids from the local user's viewpoint. */
export function acceptedFriendIds(rows: FriendshipRow[], me: string | null): string[] {
  if (!me) return [];
  return rows
    .filter((r) => r.status === "accepted")
    .map((r) => (r.requester_user_id === me ? r.addressee_user_id : r.requester_user_id));
}

/** Rows where the local user is the addressee of a still-pending request. */
export function incomingRequests(rows: FriendshipRow[], me: string | null): FriendshipRow[] {
  if (!me) return [];
  return rows.filter((r) => r.status === "pending" && r.addressee_user_id === me);
}

/** Rows the local user sent that are still awaiting an answer — the "Sent"
 *  list, where each row can be cancelled (a delete, same as declining). */
export function outgoingRequests(rows: FriendshipRow[], me: string | null): FriendshipRow[] {
  if (!me) return [];
  return rows.filter((r) => r.status === "pending" && r.requester_user_id === me);
}

/** Presence TTL. Heartbeats land every 60s, so 90s tolerates one missed beat
 *  without flapping. Backgrounding writes 'offline' immediately; this is only
 *  the fallback for a crash or lost connection. */
export const PRESENCE_TTL_MS = 90_000;

/** Is this friend around right now? `lastSeenAt` is an epoch ms timestamp;
 *  null/0 means we've never seen them. */
export function isOnline(lastSeenAt: number | null | undefined, now: number, ttlMs = PRESENCE_TTL_MS): boolean {
  if (!lastSeenAt) return false;
  return now - lastSeenAt < ttlMs;
}

/** How many accepted friends are online right now — the Home hub's real
 *  (never fake) social-proof number. */
export function onlineFriendCount(
  rows: FriendshipRow[],
  me: string | null,
  presence: Record<string, number>,
  now: number,
  ttlMs = PRESENCE_TTL_MS,
): number {
  return acceptedFriendIds(rows, me).filter((id) => isOnline(presence[id], now, ttlMs)).length;
}

/** Accepted friends ordered for display: online first, then by most recently
 *  seen. Keeps a list that is mostly offline from feeling dead. */
export function sortFriendsByPresence(
  ids: string[],
  presence: Record<string, number>,
  now: number,
  ttlMs = PRESENCE_TTL_MS,
): string[] {
  return [...ids].sort((a, b) => {
    const aOn = isOnline(presence[a], now, ttlMs);
    const bOn = isOnline(presence[b], now, ttlMs);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return (presence[b] ?? 0) - (presence[a] ?? 0);
  });
}

/** Public record shown on a profile card. Hidden below MIN_GAMES_FOR_RECORD so
 *  a new player doesn't read as "0 and 0" — and losses are never stated as a
 *  number, only implied by played-minus-won. */
export const MIN_GAMES_FOR_RECORD = 5;

export function formatRecord(gamesPlayed: number, gamesWon: number): string | null {
  if (gamesPlayed < MIN_GAMES_FOR_RECORD) return null;
  return `${gamesPlayed} played · ${gamesWon} ${gamesWon === 1 ? "win" : "wins"}`;
}

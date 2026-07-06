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

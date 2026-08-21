/**
 * Reading the room's rematch proposal off the players rows.
 *
 * A rematch is a proposal now, not the host's switch: whoever taps first opens
 * it, everyone still seated answers, and the accepters — two or more — get
 * dealt a fresh board. The server keeps the answers on `players.rematch_vote`
 * (migration 0043), which every client already re-reads on any change to that
 * table, so the vote travels on plumbing the lobby subscription provides.
 *
 * There is no "a vote is open" flag to read. The proposal IS its earliest vote:
 * the first answer stamps `rematch_voted_at`, and the window runs from there.
 * That means nothing can go out of step with anything else — a client that has
 * the rows has the whole proposal, including how long is left on it — and it
 * survives a reconnect for free, because it was never a timer in the first
 * place.
 *
 * Everything here is pure and clock-injected so the rules can be tested without
 * waiting 30 real seconds for a window to close.
 */

import type { GameState } from "@ludo/engine";

/** How long a proposal stands. Must match REMATCH_SECONDS in the edge
 *  function (room.ts) — the server is the authority, this only drives the
 *  countdown and decides when to ask it to settle. */
export const REMATCH_SECONDS = 30;

export type RematchVote = "yes" | "no";

/** The players-row fields this module needs. Structural so both api.LobbyPlayer
 *  and test fixtures satisfy it. */
export interface VoteRow {
  user_id: string;
  rematch_vote?: RematchVote | null;
  rematch_voted_at?: string | null;
}

export interface Proposal {
  /** Who opened it — the earliest vote in the room. */
  byUserId: string;
  /** ms epoch the window runs out at (drives the countdown). */
  endsAt: number;
  /** Answers so far, by auth user id. Absent = hasn't answered. */
  votes: Record<string, RematchVote>;
}

/**
 * The standing proposal, or null if none is running.
 *
 * Votes past the window are ignored rather than reported as a lapsed proposal:
 * they are rows the server hasn't swept yet, and to the player looking at the
 * results screen "lapsed" and "never happened" are the same screen. Whether the
 * lapse still needs settling is a separate question — see {@link isOverdue}.
 */
export function readProposal(rows: readonly VoteRow[], now = Date.now()): Proposal | null {
  let openedAt: number | null = null;
  let byUserId = "";
  const votes: Record<string, RematchVote> = {};
  for (const row of rows) {
    if (!row.rematch_vote || !row.rematch_voted_at) continue;
    votes[row.user_id] = row.rematch_vote;
    const at = Date.parse(row.rematch_voted_at);
    if (!Number.isFinite(at)) continue;
    if (openedAt === null || at < openedAt) {
      openedAt = at;
      byUserId = row.user_id;
    }
  }
  if (openedAt === null) return null;
  const endsAt = openedAt + REMATCH_SECONDS * 1000;
  return now < endsAt ? { byUserId, endsAt, votes } : null;
}

/**
 * Are there votes on the table whose window has run out?
 *
 * Nobody writes anything when a clock expires, so the rows sit there until a
 * client notices and asks the server to settle them — the same arrangement the
 * turn clock uses (opTimeout). Any participant may do the asking.
 */
export function isOverdue(rows: readonly VoteRow[], now = Date.now()): boolean {
  const votes = rows.filter((r) => r.rematch_vote && r.rematch_voted_at);
  if (votes.length === 0) return false;
  return readProposal(rows, now) === null;
}

/** Seats that still have a say: everyone who didn't walk out of the last game. */
export function eligibleSeats(state: GameState): { playerId: string; userId: string }[] {
  return state.players.filter((p) => !p.hasLeft).map((p) => ({ playerId: p.id, userId: p.userId }));
}

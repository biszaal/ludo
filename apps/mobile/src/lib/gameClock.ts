/**
 * How long this game has been running — the clock in the game's top bar.
 *
 * There is no start timestamp on the game state or the games row (`created_at`
 * is when the ROOM opened, which for a friend room includes however long the
 * lobby sat waiting), so the anchor is taken locally the first time a game is
 * seen on screen. One anchor is kept, keyed by game id: a remount of the game
 * screen — or a rematch handing us a new id — resolves correctly, and nothing
 * accumulates across a session.
 */

let anchor: { gameId: string; startedAt: number } | null = null;

/** Epoch ms this game's clock counts from; set on first sight of `gameId`. */
export function clockStartFor(gameId: string, now: number = Date.now()): number {
  if (!anchor || anchor.gameId !== gameId) anchor = { gameId, startedAt: now };
  return anchor.startedAt;
}

/** Drop the anchor (tests, and leaving a game). */
export function resetGameClock(): void {
  anchor = null;
}

/** Whole seconds elapsed since `startedAt` — never negative. */
export function elapsedSeconds(startedAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * m:ss, and h:mm:ss once past an hour. Minutes stay un-padded at the front
 * (7:05, not 07:05) so the pill reads like a stopwatch rather than a deadline.
 */
export function formatElapsed(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The online table belongs to one account.
 *
 * Sign-in, sign-out and account deletion replace the Supabase session in
 * place. The store, its realtime channel, its timers and the turn-retry ladder
 * keep the previous game id, and supabase-js points the socket's JWT at the
 * new user on its own. The next retry then asks for a game the new identity
 * was never seated in — a row RLS will not show, retried until it looks like
 * the game no longer exists.
 *
 * `note` is the auth listener's only hook. A change of user id releases the
 * held game so a later call that still names it is refused before it is sent,
 * then tells the store to drop the channel, the timers and the id. A token
 * refresh is the same user and does none of that.
 *
 * Until a table has been held, game calls are allowed. After `release`, none
 * are, until the next `hold`.
 */

export class GameReleasedError extends Error {
  constructor() {
    super("This game is no longer available.");
    this.name = "GameReleasedError";
  }
}

type AccountListener = (userId: string | null) => void;

export class OnlineAccount {
  /** undefined — no table yet. A string is that game. null — released. */
  private static gameId: string | null | undefined;
  private static seen: string | null | undefined;
  private static generation = 0;
  private static listener: AccountListener | null = null;

  static generationNow(): number {
    return OnlineAccount.generation;
  }

  static sameGeneration(generation: number): boolean {
    return generation === OnlineAccount.generation;
  }

  /** May a call still name this game? */
  static allows(gameId: string): boolean {
    const held = OnlineAccount.gameId;
    return held === undefined || held === gameId;
  }

  /** The table just entered. Later calls may name this id and no other. */
  static hold(gameId: string): void {
    OnlineAccount.gameId = gameId;
  }

  /**
   * Forget the held id and invalidate in-flight entries.
   *
   * A retry that already captured the id fails `allows` on its next attempt
   * and is not sent. Generation is what an entry started before this returns
   * compares against, so it does not adopt the game it just heard back.
   */
  static release(): void {
    // null, not undefined: undefined means "no gate yet" and would let the
    // next call name whatever id it still held. A release always closes it.
    OnlineAccount.gameId = null;
    OnlineAccount.generation++;
  }

  /** The online store registers the teardown. One listener. */
  static bind(listener: AccountListener): void {
    OnlineAccount.listener = listener;
  }

  /**
   * Auth-state entry. The first observation only records who is here. A later
   * different id releases the table.
   *
   * null → the first real user, with no table held, is the session arriving
   * (the anonymous sign-in at launch), not an account being replaced. An
   * in-flight create belongs to that session and must not be thrown away.
   */
  static note(userId: string | null): void {
    const previous = OnlineAccount.seen;
    OnlineAccount.seen = userId;
    if (previous === undefined) {
      OnlineAccount.listener?.(userId);
      return;
    }
    if (previous !== userId) {
      const sessionArriving =
        previous === null && userId !== null && OnlineAccount.gameId === undefined;
      if (!sessionArriving) OnlineAccount.release();
    }
    OnlineAccount.listener?.(userId);
  }

  /** Tests start from an unbound gate. Production never calls this. */
  static testingOnlyReset(): void {
    OnlineAccount.gameId = undefined;
    OnlineAccount.seen = undefined;
    OnlineAccount.generation = 0;
  }
}

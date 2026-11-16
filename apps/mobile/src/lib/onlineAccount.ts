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
 * `note` is the auth listener's only hook. A different account signing in
 * releases the held game so a later call that still names it is refused before it is sent,
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

type AccountListener = (userId: string) => void;

export class OnlineAccount {
  /** undefined — no table yet. A string is that game. null — released. */
  private static gameId: string | null | undefined;
  /** The last account that was actually signed in. undefined — none yet. */
  private static owner: string | undefined;
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
   * Auth-state entry. The table is released when a DIFFERENT account arrives,
   * and at no other time.
   *
   * A null session is not an arrival. supabase-js reports SIGNED_OUT when a
   * refresh fails, and the app then restores the same account from the keychain
   * (lib/identity). Tearing the table down on that null would throw a player
   * out of a live, possibly staked, match for a blip they never saw — so a null
   * changes nothing, and the same id coming back keeps the table. A real
   * sign-out or deletion is always followed by another account signing in
   * (auth.ts signs a fresh guest in straight away), and that arrival is what
   * releases the game. In between, the session is empty and every game call
   * fails authentication on its own.
   *
   * The first account seen only records who is here: it is the session
   * arriving at launch, and an in-flight create belongs to it.
   */
  static note(userId: string | null): void {
    if (userId === null) return;
    const previous = OnlineAccount.owner;
    OnlineAccount.owner = userId;
    if (previous !== undefined && previous !== userId) OnlineAccount.release();
    OnlineAccount.listener?.(userId);
  }
  /** Tests start from an unbound gate. Production never calls this. */
  static testingOnlyReset(): void {
    OnlineAccount.gameId = undefined;
    OnlineAccount.owner = undefined;
    OnlineAccount.generation = 0;
  }
}

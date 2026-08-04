-- Defence in depth on the grant layer. Behaviour-preserving by construction:
-- every privilege removed here is one RLS already denies, so nothing the app
-- does today can notice. The point is to stop relying on RLS as the ONLY thing
-- between a client and the wallet table.
--
-- Supabase's default `grant all on all tables in schema public to anon,
-- authenticated` is what put us here: every table currently hands out INSERT,
-- UPDATE, DELETE and TRUNCATE to both roles, and only the policies say no. One
-- over-broad policy added later — or one `using (true)` typed in a hurry — and
-- there is nothing underneath. TRUNCATE is worse than the rest: it is not
-- subject to RLS at all.
--
-- METHOD. For each table, keep exactly the write verbs that have a matching
-- policy, revoke the rest. Derived from the live policy catalogue, not from
-- reading the client:
--
--   blocks         policies DELETE,INSERT      -> keep both
--   friendships    policies DELETE,INSERT,UPDATE -> keep all three
--   profiles       policies INSERT,UPDATE      -> keep both
--   room_invites   policies DELETE,INSERT      -> keep both
--   user_presence  policies INSERT,UPDATE      -> keep both
--   players        policy   UPDATE             -> 0019 already scoped this to
--                                                 (is_connected, missed_turns)
--   everything else: SELECT-only policies, or none at all -> no writes
--
-- ROLLBACK: `grant all on all tables in schema public to anon, authenticated;`
-- and re-grant execute on the functions (see section 2).

-- ---------------------------------------------------------------------------
-- 1. Table writes
-- ---------------------------------------------------------------------------

-- 1a. Tables the client never writes. All writes here are already dead under
-- RLS (SELECT-only policies), or the table has no policies whatsoever and is
-- service-role territory (bot_identities, game_bots, rate_limits).
revoke insert, update, delete, truncate on
  public.ad_rewards, public.app_config, public.catalog, public.entitlements,
  public.friend_codes, public.games, public.gem_txns, public.iap_purchases,
  public.moves, public.player_stats, public.wallet_txns, public.wallets,
  public.bot_identities, public.game_bots, public.rate_limits
from anon, authenticated;

-- bot_identities / game_bots / rate_limits have no SELECT policy either, so
-- reads are already denied. Drop the grant so the intent is legible in \dp.
revoke select on public.bot_identities, public.game_bots, public.rate_limits
from anon, authenticated;

-- 1b. Tables the client does write — trim to the policy-backed verbs only.
revoke update, truncate on public.blocks        from anon, authenticated;
revoke truncate        on public.friendships    from anon, authenticated;
revoke delete, truncate on public.profiles      from anon, authenticated;
revoke update, truncate on public.room_invites  from anon, authenticated;
revoke delete, truncate on public.user_presence from anon, authenticated;
revoke insert, delete, truncate on public.players from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Function execute
-- ---------------------------------------------------------------------------
-- These are internal helpers — trigger bodies, RLS predicates, and the money
-- primitives. The client makes no PostgREST RPC calls at all (verified across
-- apps/mobile/src: zero `.rpc(` call sites), so none of them need to be
-- reachable at /rest/v1/rpc/*.
--
-- Note the grammar: EXECUTE arrives via a default grant to PUBLIC, and
-- `revoke ... from authenticated` does NOT remove a PUBLIC grant. It has to be
-- revoked from PUBLIC and then handed back to service_role, which is the role
-- the edge functions authenticate as.
--
-- wallet_apply and quick_match_claim each have two overloads; a bare function
-- name is ambiguous, so every signature is spelled out.

revoke execute on function
  public.assign_friend_code(),
  public.block_cascade(),
  public.claim_bot_identity(uuid),
  public.enforce_dice_skin_ownership(),
  public.gem_apply(uuid, integer, text, text),
  public.gems_exchange(uuid, integer, integer, text),
  public.mark_game_has_bots(),
  public.quick_match_claim(uuid, integer),
  public.quick_match_claim(uuid, integer, integer),
  public.rate_limit_hit(uuid, text, integer),
  public.reap_stale_games(),
  public.stats_record(uuid[], uuid),
  public.wallet_apply(uuid, integer, text, uuid),
  public.wallet_apply(uuid, integer, text, uuid, text, text),
  public.wallet_read(uuid)
from public;

grant execute on function
  public.assign_friend_code(),
  public.block_cascade(),
  public.claim_bot_identity(uuid),
  public.enforce_dice_skin_ownership(),
  public.gem_apply(uuid, integer, text, text),
  public.gems_exchange(uuid, integer, integer, text),
  public.mark_game_has_bots(),
  public.quick_match_claim(uuid, integer),
  public.quick_match_claim(uuid, integer, integer),
  public.rate_limit_hit(uuid, text, integer),
  public.reap_stale_games(),
  public.stats_record(uuid[], uuid),
  public.wallet_apply(uuid, integer, text, uuid),
  public.wallet_apply(uuid, integer, text, uuid, text, text),
  public.wallet_read(uuid)
to service_role;

-- DELIBERATELY EXEMPT: is_game_participant and is_blocked.
--
-- Both are called from inside RLS policy expressions —
-- is_game_participant(id) guards the games/players/moves reads, is_blocked()
-- guards `friendships: send`. A policy predicate is evaluated with the
-- QUERYING user's privileges, so revoking their EXECUTE from authenticated
-- would not harden anything; it would make every one of those policies raise
-- a permission error and take online play down.
--
-- They stay callable, but only for signed-in users: dropping the PUBLIC grant
-- still takes `anon` (unauthenticated, publishable-key) off them. What remains
-- is that a signed-in user can probe "are these two blocked" / "is this user in
-- that game" one call at a time — booleans, no data, and the linter's warning
-- for these two is expected to persist.
revoke execute on function
  public.is_blocked(uuid, uuid),
  public.is_game_participant(uuid)
from public;

grant execute on function
  public.is_blocked(uuid, uuid),
  public.is_game_participant(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. search_path on SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Every one of these already pins `search_path=public`, which is most of the
-- job. What is missing is pg_temp: for TABLE lookups Postgres searches the
-- temporary schema FIRST unless pg_temp appears explicitly in search_path, so
-- a caller can create a temp table shadowing an unqualified reference inside a
-- SECURITY DEFINER body. Naming pg_temp last puts it where it can't shadow.
--
-- Matters most on wallet_apply/gem_apply/gems_exchange, which move currency.
alter function public.assign_friend_code()                              set search_path = public, extensions, pg_temp;
alter function public.block_cascade()                                   set search_path = public, pg_temp;
alter function public.claim_bot_identity(uuid)                          set search_path = public, pg_temp;
alter function public.enforce_dice_skin_ownership()                     set search_path = public, pg_temp;
alter function public.gem_apply(uuid, integer, text, text)              set search_path = public, pg_temp;
alter function public.gems_exchange(uuid, integer, integer, text)       set search_path = public, pg_temp;
alter function public.is_blocked(uuid, uuid)                            set search_path = public, pg_temp;
alter function public.is_game_participant(uuid)                         set search_path = public, pg_temp;
alter function public.mark_game_has_bots()                              set search_path = public, pg_temp;
alter function public.quick_match_claim(uuid, integer)                  set search_path = public, pg_temp;
alter function public.quick_match_claim(uuid, integer, integer)         set search_path = public, pg_temp;
alter function public.rate_limit_hit(uuid, text, integer)               set search_path = public, pg_temp;
alter function public.reap_stale_games()                                set search_path = public, pg_temp;
alter function public.stats_record(uuid[], uuid)                        set search_path = public, pg_temp;
alter function public.wallet_apply(uuid, integer, text, uuid)           set search_path = public, pg_temp;
alter function public.wallet_apply(uuid, integer, text, uuid, text, text) set search_path = public, pg_temp;
alter function public.wallet_read(uuid)                                 set search_path = public, pg_temp;

-- touch_updated_at is SECURITY INVOKER, so an unpinned search_path cannot
-- escalate anything — it runs as whoever fired the trigger. Pinned anyway to
-- clear the linter and keep the rule uniform.
alter function public.touch_updated_at() set search_path = public, pg_temp;

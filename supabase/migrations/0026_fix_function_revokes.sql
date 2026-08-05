-- Correction to 0024. Its function revokes were written as:
--
--   revoke execute on function ... from public;
--
-- on the reasoning that EXECUTE arrives via a default grant to PUBLIC. That is
-- true of stock PostgreSQL but NOT of Supabase, which additionally issues
-- explicit grants:
--
--   grant all on all functions in schema public to anon, authenticated, service_role;
--
-- An explicit `anon=X/postgres` entry is not removed by revoking from PUBLIC,
-- so four functions kept their grants and the linter kept warning. It looked
-- like it had worked because the money primitives (wallet_apply, gem_apply,
-- rate_limit_hit) were already locked down by 0010/0015/0018, which did name
-- the roles.
--
-- Verified before writing this: only these four still carry anon/authenticated
-- EXECUTE.
--
-- ROLLBACK: grant execute on the listed functions back to anon, authenticated.

-- ---------------------------------------------------------------------------
-- 1. Trigger functions
-- ---------------------------------------------------------------------------
-- Both return `trigger`, so PostgREST refuses to invoke them over /rpc/ no
-- matter who holds EXECUTE — the practical exposure here is nil and this is
-- hygiene, not a live hole.
--
-- Safe because a trigger's EXECUTE privilege is checked when the trigger is
-- CREATED, not each time it fires. This database already demonstrates it:
-- assign_friend_code() and block_cascade() are trigger functions that earlier
-- migrations revoked from anon and authenticated, and friend codes and blocking
-- both work in production today.
revoke execute on function
  public.enforce_dice_skin_ownership(),
  public.mark_game_has_bots()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. is_blocked — drop anon, keep authenticated
-- ---------------------------------------------------------------------------
-- Called inside the `friendships: send` WITH CHECK. A policy predicate is
-- evaluated with the QUERYING user's privileges, so authenticated must keep
-- EXECUTE or sending a friend request starts failing. `anon` never evaluates
-- that policy (the table is authenticated-only), so it has no reason to hold it.
--
-- is_game_participant is untouched: it already lost anon, and authenticated
-- needs it for the games/players/moves read policies. Its remaining linter
-- warning is expected and documented in 0024.
revoke execute on function public.is_blocked(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Post-apply verification
-- ---------------------------------------------------------------------------
-- 1) No SECURITY DEFINER function should be anon-executable, and only
--    is_game_participant + is_blocked should be authenticated-executable:
--
--      select p.proname, p.proacl::text
--        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and p.prosecdef
--         and (p.proacl::text like '%anon=X%' or p.proacl::text like '%authenticated=X%');
--
-- 2) The dice-skin trigger must still fire. As a signed-in user, equipping a
--    skin you do not own must still come back null rather than erroring:
--
--      set local role authenticated;
--      set local request.jwt.claims = '{"sub":"<a real user id>","role":"authenticated"}';
--      update public.profiles set dice_skin = 'gold' where user_id = '<same id>'
--        returning dice_skin;   -- expect NULL (stripped), NOT a permission error
--      reset role;

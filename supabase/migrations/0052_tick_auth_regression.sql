-- Restore the Authorization header 0049 dropped. The tick has been 401ing since.
--
-- 0036 exists for exactly one reason: the `game` function is deployed with
-- verify_jwt = true, so Supabase's edge gateway demands an Authorization header
-- before any of our code runs. opTick authenticates itself with x-tick-secret,
-- which is true of the FUNCTION and false of the platform in front of it. Every
-- cron firing without an Authorization header comes back
--
--   401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
--
-- 0049 redefined tick_games() in full to add the idle gate — a good change, 8.6%
-- of the free plan's invocation budget — but it rebuilt the function body from
-- 0034 rather than 0036, so the Authorization header and the tick_auth_key
-- lookup went with it. Nothing after 0049 touches tick_games, so that is the
-- live definition.
--
-- Nothing surfaced it. net.http_post is fire-and-forget, so cron.job_run_details
-- reports "succeeded" every minute for having POSTed; the rejection only exists
-- in net._http_response. The visible symptom is the one 0034 was written to
-- prevent: an abandoned table stays frozen and its pot stays debited, because
-- settleUnpaid and advanceStalled are only reachable through this call.
--
-- This migration is 0049's gate and 0036's headers, together. Nothing else.
--
--   select status_code, count(*) from net._http_response
--    where created >= now() - interval '2 hours' group by 1;
--
-- should turn from 401s to 200s within two minutes of applying it.

create or replace function public.tick_games()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url  text;
  fn_key  text;
  fn_auth text;
begin
  -- 0049's gate. Nothing stalled and nothing unpaid: do not wake the edge
  -- function at all. Both predicates are index-backed (games_active_deadline_idx,
  -- games_unpaid_idx from 0034) and MUST stay a superset of what tick.ts acts
  -- on -- 15 seconds matches TICK_GRACE_MS, stake > 0 matches settleUnpaid.
  if not exists (
        select 1 from games
         where status = 'active'
           and turn_deadline is not null
           and turn_deadline < now() - interval '15 seconds'
      )
     and not exists (
        select 1 from games
         where status = 'finished'
           and payout_done = false
           and stake > 0
      )
  then
    return;
  end if;

  select value into fn_url  from internal_config where key = 'tick_url';
  select value into fn_key  from internal_config where key = 'tick_secret';
  select value into fn_auth from internal_config where key = 'tick_auth_key';
  -- Not configured yet (or a local stack) -- nothing to do, and nothing broken.
  -- fn_auth is in this test deliberately: without it the POST is a guaranteed
  -- 401, so a missing key must mean "do not call", not "call and be rejected".
  if fn_url is null or fn_key is null or fn_auth is null then
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a
  -- slow or unreachable edge function can never hold the cron worker open.
  --
  -- Note this means a REJECTED request is silent here too: check
  -- net._http_response, not cron.job_run_details, to see whether a tick landed.
  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || fn_auth,
                 'x-tick-secret',  fn_key
               ),
    body    := jsonb_build_object('op', 'tick'),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.tick_games() from public, anon, authenticated;

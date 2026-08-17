-- The tick never reached the function: 401 at the gateway, once a minute.
--
-- 0034 sent only `x-tick-secret`, reasoning that opTick authenticates itself
-- with a shared secret and needs no JWT. That is true of the FUNCTION, and
-- false of the platform in front of it. The `game` function is deployed with
-- verify_jwt = true, so Supabase's edge gateway demands an Authorization header
-- before any of our code runs. Every cron firing came back
--
--   401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
--
-- and, because net.http_post is fire-and-forget, nothing surfaced it: cron
-- reported "succeeded" every minute (it had, in posting the request) while the
-- heartbeat did nothing at all. The evidence is in net._http_response.
--
-- The fix is an Authorization header carrying the PUBLISHABLE (anon) key. That
-- gets past the gateway and grants nothing on its own — opTick still checks
-- x-tick-secret against TICK_SECRET and fails closed, and it does its work
-- through the service-role client it builds from its own env. Using the service
-- key here instead would hand the cron path privileges it does not need and put
-- a real secret in a table, so: anon.
--
-- Turning verify_jwt off for the function was the other option and is worse —
-- it would drop JWT checks from every player-facing op to fix one internal
-- caller.
--
-- SETUP (once per environment; the key is environment-specific, so it lives in
-- config rather than in this file):
--
--   insert into internal_config (key, value)
--   values ('tick_auth_key', '<the project anon / publishable key>')
--   on conflict (key) do update set value = excluded.value;
--
-- Until that row exists tick_games() no-ops, exactly as it did before the url
-- and secret were configured. No row, no tick — never an unauthenticated call.

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
  select value into fn_url  from internal_config where key = 'tick_url';
  select value into fn_key  from internal_config where key = 'tick_secret';
  select value into fn_auth from internal_config where key = 'tick_auth_key';
  -- Not configured yet (or a local stack) — nothing to do, and nothing broken.
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

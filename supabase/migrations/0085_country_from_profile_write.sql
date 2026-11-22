-- 0085: fill a player's country from their own profile write.
--
-- 0083 read Cloudflare's cf-ipcountry header in the game edge function, and no
-- real player ever got a flag: Supabase drops that header before a request
-- reaches the function runtime. A probe on 2026-11-22 saw cf-connecting-ip and
-- x-forwarded-for there, never cf-ipcountry. PostgREST requests do carry it
-- (the same probe read the caller's own country from request.headers).
--
-- Every build with flags writes its own profile row through PostgREST when it
-- creates or joins an online game (api.upsertMyProfile), so this trigger fills
-- the country with no app update. Same rules as profile_set_country: fill an
-- empty country once, never a hidden one.
--
-- Only the player's own write counts. The game function also writes profiles
-- through PostgREST, and its header names where the server is, not the player.
-- Bots never write with their own JWT, so they never match either.

create or replace function public.profiles_fill_country()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  code text;
begin
  if new.country is not null or new.country_hidden then return new; end if;
  if auth.uid() is distinct from new.user_id then return new; end if;

  begin
    code := upper(btrim(coalesce(
      nullif(current_setting('request.headers', true), '')::json ->> 'cf-ipcountry', '')));
  exception when others then
    return new; -- a malformed header blob must never cost the player their write
  end;

  -- XX is Cloudflare's "unknown", T1 is Tor.
  if code ~ '^[A-Z]{2}$' and code not in ('XX', 'T1') then
    new.country := code;
  end if;
  return new;
end;
$$;

create or replace trigger profiles_fill_country
  before insert or update on public.profiles
  for each row execute function public.profiles_fill_country();

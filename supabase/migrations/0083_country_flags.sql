-- 0083: a country flag next to each player's name.
--
-- Plan: docs/superpowers/plans/2026-11-20-country-flags.md
--
-- Only a two-letter ISO code is kept: never an IP address, a city or
-- coordinates. The game function reads it from Cloudflare's cf-ipcountry
-- header (every request carries one) and calls profile_set_country, which
-- fills the column once and never again. A player who hides their flag sets
-- country_hidden (and clears country) on their own row; the header then never
-- sets it back.
--
-- Hidden quick-match bots have to look like everyone else, and a flag that
-- doesn't suit the name (an Indian name under a Brazilian flag) gives a seat
-- away. bot_country_for gives each name a country that fits it, spreads guest
-- handles roughly the way real players are spread, and leaves about one in ten
-- without a flag, as some players hide theirs. Labelled friend-room bots have
-- no profile row and stay colour-only.

alter table public.profiles
  add column if not exists country text check (country ~ '^[A-Z]{2}$'),
  add column if not exists country_hidden boolean not null default false;

-- ---------------------------------------------------------------------------
-- A real player's country, from the request header
-- ---------------------------------------------------------------------------
create or replace function public.profile_set_country(p_user uuid, p_country text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  code    text := upper(btrim(coalesce(p_country, '')));
  changed int;
begin
  -- XX is Cloudflare's "unknown", T1 is Tor.
  if code !~ '^[A-Z]{2}$' or code in ('XX', 'T1') then return false; end if;
  if exists (select 1 from bot_identities where user_id = p_user) then return false; end if;

  update profiles
     set country = code
   where user_id = p_user
     and country is null
     and not country_hidden;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- A hidden bot's country, from its name
-- ---------------------------------------------------------------------------
create or replace function public.bot_country_for(p_user uuid, p_name text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  first  text := regexp_replace(split_part(lower(btrim(coalesce(p_name, ''))), ' ', 1), '[0-9]+$', '');
  bucket int;
begin
  case first
    when 'arjun', 'priya', 'rahul', 'ravi', 'nikhil', 'divya', 'ipsita', 'aarav' then return 'IN';
    when 'maya', 'mina', 'tara' then return 'NP';
    when 'anika', 'nadia' then return 'BD';
    when 'aisha' then return 'PK';
    when 'omar' then return 'AE';
    when 'sofia', 'lucas', 'clara' then return 'BR';
    when 'mateo', 'elena' then return 'ES';
    when 'tomas' then return 'PT';
    when 'jonas', 'lena', 'felix' then return 'DE';
    when 'marco' then return 'IT';
    when 'daniel', 'leo', 'noah', 'zoe', 'sam' then return 'US';
    when 'isla', 'amara' then return 'GB';
    when 'kenji' then return 'JP';
    else null;
  end case;

  bucket := ((hashtext(p_user::text)::bigint % 100) + 100) % 100;
  return case
    when bucket < 50 then 'IN'
    when bucket < 65 then 'NP'
    when bucket < 75 then 'BD'
    when bucket < 80 then 'PK'
    when bucket < 85 then 'AE'
    when bucket < 90 then 'US'
    else null
  end;
end;
$$;

-- For a bot minted after this migration (bots.ts calls it after the profile
-- insert). Leaves a country that is already set alone.
create or replace function public.bot_assign_country(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result text;
begin
  update profiles
     set country = public.bot_country_for(user_id, display_name)
   where user_id = p_user and country is null;
  select country into result from profiles where user_id = p_user;
  return result;
end;
$$;

-- Every hidden bot that exists today.
update public.profiles p
   set country = public.bot_country_for(p.user_id, p.display_name)
  from public.bot_identities b
 where b.user_id = p.user_id
   and not b.visible
   and p.country is null;

revoke all on function public.profile_set_country(uuid, text) from public, anon, authenticated;
revoke all on function public.bot_country_for(uuid, text) from public, anon, authenticated;
revoke all on function public.bot_assign_country(uuid) from public, anon, authenticated;
grant execute on function public.profile_set_country(uuid, text) to service_role;
grant execute on function public.bot_country_for(uuid, text) to service_role;
grant execute on function public.bot_assign_country(uuid) to service_role;

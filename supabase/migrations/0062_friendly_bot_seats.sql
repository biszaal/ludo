-- Friendly-room bots are a separate, anonymous pool — and they never speak.
--
-- 0035 made bot-ness visible per seat (players.is_bot) so a friend room could
-- label the chairs the host chose to fill. What it kept sharing with quick
-- match was the IDENTITY POOL, and that is the leak: the labelled seat in a
-- friend room shows the pooled profile's name and face, so a player who plays
-- one friendly fill learns that "Maya" with the pigtails is a bot. Meet Maya
-- again in quick match — where the whole point is that nothing says bot — and
-- the camouflage is gone, for that opponent and, by implication, for the pool.
--
-- Three changes close it:
--
--   1. The pool splits in two. `bot_identities.visible` marks the identities
--      that may sit a LABELLED seat; claim_bot_identity (the hidden quick-match
--      claim) never returns one, and the new claim_visible_bot_identity returns
--      only those. No identity is ever seen in both roles again.
--
--   2. A visible identity carries NO profiles row. There is no name to leak and
--      no face to recognise: the client has fallen back to the seat's colour
--      label ("Red", "Blue") for a profile-less user since 0003, which is
--      exactly what a labelled bot should read as. Nothing about it can be
--      matched against a quick-match opponent, because there is nothing there.
--
--   3. game_bots.can_chat. Bot chat (0040) exists to keep a HIDDEN seat from
--      giving itself away by silence. A seat wearing a BOT tag has nothing to
--      hide, and a labelled bot posting "Nice move!" and a laughing sprite is
--      worse than silence — it is the same chatter the player will later meet
--      from a "human" in quick match, teaching them what a bot sounds like.
--      So the talkative seats stay where the disguise is: matchmaking only.
--
-- The identities already burned are retired below, because the leak has been
-- running in production since 0035 shipped.

-- 1. ---------------------------------------------------------------------
alter table public.bot_identities
  add column if not exists visible boolean not null default false;

-- Chat is per SEAT, not per identity: the flag is what seatBots knew at seating
-- time, and reading it costs nothing because loadBotSeats already selects this
-- row on every write. Deriving it from bot_identities instead would put a join
-- on the hot path to answer a question the seating already knew.
alter table public.game_bots
  add column if not exists can_chat boolean not null default true;

-- 2. ---------------------------------------------------------------------
-- The hidden claim, unchanged from 0040 except that the visible pool is now
-- excluded from BOTH picks — the fallback included, or a busy table would quietly
-- seat a labelled identity into a quick match and undo the whole point of this.
create or replace function public.claim_bot_identity(p_game uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
  recent uuid[];
begin
  with humans as (
    select p.user_id
      from players p
     where p.game_id = p_game
       and not exists (select 1 from bot_identities b where b.user_id = p.user_id)
  ),
  recent_games as (
    select r.game_id
      from humans h
      cross join lateral (
        select p.game_id
          from players p
         where p.user_id = h.user_id
         order by p.created_at desc
         limit 12
      ) r
  )
  -- coalesce is load-bearing: `x = any(null)` is NULL, which would filter out
  -- every candidate row instead of none of them.
  select coalesce(array_agg(distinct gb.user_id), '{}'::uuid[])
    into recent
    from game_bots gb
    join recent_games rg on rg.game_id = gb.game_id;

  select user_id into b_id
    from bot_identities
   where in_use_game_id is null
     and not visible
     and not (user_id = any(recent))
   order by random()
   limit 1
   for update skip locked;

  if b_id is null then
    select user_id into b_id
      from bot_identities
     where in_use_game_id is null
       and not visible
     order by random()
     limit 1
     for update skip locked;
  end if;

  if b_id is null then
    return null;
  end if;

  update bot_identities set in_use_game_id = p_game where user_id = b_id;
  return b_id;
end;
$$;

revoke all on function public.claim_bot_identity(uuid) from public, anon, authenticated;
grant execute on function public.claim_bot_identity(uuid) to service_role;

-- The labelled claim. No recency preference, deliberately: these seats have no
-- name, no face and no voice, so there is nothing for a player to recognise
-- across games and nothing variety could buy. Release is shared with the hidden
-- pool (in_use_game_id, cleared by the same update in bots.ts).
create or replace function public.claim_visible_bot_identity(p_game uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
begin
  select user_id into b_id
    from bot_identities
   where in_use_game_id is null
     and visible
   order by random()
   limit 1
   for update skip locked;

  if b_id is null then
    return null;
  end if;

  update bot_identities set in_use_game_id = p_game where user_id = b_id;
  return b_id;
end;
$$;

revoke all on function public.claim_visible_bot_identity(uuid) from public, anon, authenticated;
grant execute on function public.claim_visible_bot_identity(uuid) to service_role;

-- 3. ---------------------------------------------------------------------
-- Retire the identities that have already sat a labelled seat.
--
-- Every one of them has been shown by name, with a BOT tag next to it, to
-- whoever was in that friend room. They can never be a convincing quick-match
-- opponent for those players again, so they move to the visible pool for good
-- rather than staying in rotation.
update public.bot_identities b
   set visible = true
 where exists (
   select 1 from public.players p
    where p.user_id = b.user_id
      and p.is_bot
 );

-- And drop their profiles, so the name and face are gone rather than merely
-- unused. Skipped for any identity currently seated: it may be mid-game as a
-- hidden opponent right now, and a name that vanishes from the table mid-match
-- is a louder tell than the one this migration is fixing. That identity keeps
-- its row until its next claim, which the flag above has already made a
-- labelled one.
delete from public.profiles pr
 using public.bot_identities b
 where b.user_id = pr.user_id
   and b.visible
   and b.in_use_game_id is null;

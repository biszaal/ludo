-- Bot variety and chat.
--
-- Three problems with the hidden fill-in seats, all visible in production:
--
--   1. The same "opponents" keep coming back. claim_bot_identity picks at
--      random with no memory, and a 4-player quick match draws THREE at a time,
--      so ten games is ~30 draws from a 103-identity pool. Repeats are near
--      certain, and the named identities are the memorable ones.
--   2. Bot seats never speak, while every human has emoji and quick messages.
--      Silence is a tell, and it makes the table feel dead.
--   3. Names and avatars were picked independently, so the pool is full of
--      mismatches: Sofia wearing the beard, Daniel wearing the pigtails.
--
-- This migration fixes (1) in SQL, gives (2) the state it needs to pace itself,
-- and repairs (3) in the rows that already exist. The edge function carries the
-- matching forward for identities minted from here on.

-- 1. ---------------------------------------------------------------------
-- Claim a free bot identity the humans at this table have NOT played lately.
--
-- Same signature as 0009, so callers and the 0024/0026 grants are untouched;
-- only the body changes. The exclusion is a preference, never a requirement:
-- when it empties the pool the second pick ignores it, because filling the
-- seat always beats perfect variety.
--
-- The lookback is seat rows, not games rows, so it reads the caller's OWN
-- history via players_user_recent_idx (user_id, created_at desc) — twelve index
-- rows per human, then a pkey-prefix join on game_bots. Cheap enough to run on
-- every seat.
--
-- Ordering is load-bearing: quick match and friend rooms both seat their humans
-- before seatBots runs, so `humans` is never empty when this matters.
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
     and not (user_id = any(recent))
   order by random()
   limit 1
   for update skip locked;

  if b_id is null then
    select user_id into b_id
      from bot_identities
     where in_use_game_id is null
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

-- create or replace preserves the existing ACL, but 0026's lesson was that
-- Supabase's default grants are explicit per role — so state them rather than
-- trusting a fresh replay to inherit the right thing.
revoke all on function public.claim_bot_identity(uuid) from public, anon, authenticated;
grant execute on function public.claim_bot_identity(uuid) to service_role;

-- 2. ---------------------------------------------------------------------
-- Per-game chat pacing for a bot seat: how much it has said here, and when it
-- last spoke. Edge isolates share no memory, so the cooldown has to live
-- somewhere both a driving isolate and a reacting one can see.
--
-- game_bots is RLS-on with no policies (0009), so none of this is client
-- readable and a chatty seat can't be fingerprinted by its counters.
alter table public.game_bots
  add column if not exists chat_count   integer not null default 0,
  add column if not exists last_chat_at timestamptz;

-- 3. ---------------------------------------------------------------------
-- Repair the avatars already in the pool.
--
-- Only avatar_id moves; names are left exactly as they are. An avatar whose
-- style hides the hairline (cap, beanie, headphones, crown, afro, cat) reads as
-- anyone, so it is compatible with every name and is never rewritten.
--
-- Two grounds for repair: the face disagrees with the name, or the face is from
-- the gem tier, which no bot should ever wear (see `assignable` below).
--
-- Idempotent: after this runs there is nothing left to repair, so a second run
-- updates nothing.
with name_presents(base, presents) as (values
  ('Maya','f'), ('Arjun K','m'), ('Sofia','f'), ('Leo M','m'),
  ('Priya','f'), ('Daniel','m'), ('Amara','f'), ('Kenji','m'),
  ('Lucas P','m'), ('Anika','f'), ('Mateo','m'), ('Zoe','f'),
  ('Rahul','m'), ('Elena V','f'), ('Sam T','n'), ('Nadia','f'),
  ('Omar','m'), ('Isla','f'), ('Ravi J','m'), ('Clara','f'),
  ('Tomas','m'), ('Mina K','f'), ('Jonas','m'), ('Aisha','f'),
  ('Nikhil','m'), ('Lena','f'), ('Marco B','m'), ('Tara','f'),
  ('Felix','m'), ('Divya','f'), ('Noah S','m'), ('Ipsita','f')
),
-- How each avatar READS. Includes the gem tier so a bot already wearing one is
-- still classified correctly.
avatar_presents(avatar, presents) as (values
  ('zara','f'), ('nina','f'), ('ruby','f'),        -- bun, pigtails, bow
  ('sunny','m'), ('milo','m'), ('bruno','m'),      -- spiky, side part, beard
  ('nova','m'),                                    -- gem tier, spiky
  ('leo','n'), ('coco','n'), ('rex','n'),          -- crown, afro, cap
  ('ivy','n'), ('ace','n'), ('kito','n'),          -- beanie, headphones, cat
  ('onyx','n')                                     -- gem tier, cap
),
-- What a repair may HAND OUT, which is a strictly smaller set: the same twelve
-- BOT_AVATARS uses in bots.ts. The gem tier (0018) is excluded for the reason
-- the prestige dice skins are — a hidden "opponent" wearing a premium cosmetic
-- invites exactly the scrutiny these seats exist to avoid.
assignable(avatar, presents) as (
  select avatar, presents from avatar_presents where avatar not in ('nova', 'onyx')
),
-- Collision suffixes are digits appended to the base name (Aisha93, Mina K56),
-- so stripping them recovers the name we tagged. guest###### strips to "guest"
-- and matches nothing — a guest handle implies no presentation, which is 'n'.
bots as (
  select pr.user_id,
         pr.avatar_id,
         regexp_replace(pr.display_name, '[0-9]+$', '') as base
    from public.profiles pr
    join public.bot_identities bi on bi.user_id = pr.user_id
),
-- Left joins throughout: a name we don't tag, or an avatar we don't recognise,
-- must still reach the gem-tier check below rather than being dropped by an
-- inner join before it gets there.
tagged as (
  select b.user_id,
         b.avatar_id,
         coalesce(np.presents, 'n') as want,
         ap.presents as avatar_reads
    from bots b
    left join name_presents np on np.base = b.base
    left join avatar_presents ap on ap.avatar = b.avatar_id
),
mismatched as (
  select t.user_id, t.want
    from tagged t
   where (t.want <> 'n' and t.avatar_reads is not null
          and t.avatar_reads <> 'n' and t.avatar_reads <> t.want)
      -- A bot holding a gem-tier face is wrong however well it matches the
      -- name, so it is repaired on that ground alone — guest handles included.
      or t.avatar_id in ('nova', 'onyx')
),
repaired as (
  select m.user_id,
         (select a.avatar
            from assignable a
           where a.presents in (m.want, 'n')
           order by random()
           limit 1) as avatar
    from mismatched m
)
update public.profiles pr
   set avatar_id = r.avatar
  from repaired r
 where pr.user_id = r.user_id;

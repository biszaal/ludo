-- Friend discovery + anti-abuse.
--
-- 0005 shipped friendships with no way to find anyone: you could only add a
-- player whose uid you already had from a shared game. This adds shareable
-- friend CODES (the out-of-app growth loop) and the groundwork for a
-- "recently played with" list, then closes the abuse surface that discovery
-- opens up.
--
-- SECRECY CONSTRAINT (inherited from 0009): bots are real auth users with
-- ordinary profiles rows, and nothing client-readable may mark a seat as a bot.
-- Hence two things here: "recently played with" is an edge-function op (the
-- client cannot subtract game_bots because it cannot read game_bots), and a
-- friend request aimed at a bot is auto-declined on a randomized 45s-4min
-- delay rather than instantly — an instant decline is itself a tell.
--
-- Edge function (service role) owns: friend_codes writes, rate_limits.
-- Clients own (via RLS): blocks, and friendship accept/decline/cancel.
--
-- Deliberately NOT added: search by display name. It is the only discovery
-- path that turns the profile directory into a targeting tool, and codes plus
-- recently-played cover the real cases.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- friend_codes: a short shareable capability, one per player.
--
-- Deliberately NOT a column on profiles: that table is `select using (true)`
-- (0003:18), so a code living there would be world-readable and would stop
-- being a capability the moment it shipped.
-- ---------------------------------------------------------------------------

-- Same alphabet as genCode() in functions/game/index.ts: 32 chars, no O/0/I/1.
-- 256 % 32 == 0, so the modulo over a random byte is unbiased. 32^6 ~= 1.07e9.
create or replace function public.gen_friend_code()
returns text
language plpgsql
set search_path = public, extensions
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes    bytea;
  code     text := '';
  i        int;
begin
  -- Unqualified on purpose: `create extension if not exists` above is a no-op
  -- if pgcrypto is already installed in a DIFFERENT schema, in which case a
  -- hardcoded `extensions.` prefix would fail. The search_path covers both.
  bytes := gen_random_bytes(6);
  for i in 0..5 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

create table if not exists public.friend_codes (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null unique
               check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  created_at timestamptz not null default now()
);

alter table public.friend_codes enable row level security;

-- You may read only your own code. Looking someone up BY code goes through the
-- edge function, which is where the lookup throttle lives.
drop policy if exists "friend_codes: self read" on public.friend_codes;
create policy "friend_codes: self read"
  on public.friend_codes for select to authenticated using (user_id = auth.uid());
-- no write policies: edge function (service role) only

-- Assign on profile creation. The existence check inside races under
-- concurrency; the unique index is the real guarantee, so we retry on
-- collision and give up quietly — opFriendCode assigns lazily on first read.
create or replace function public.assign_friend_code()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  attempt int := 0;
begin
  loop
    begin
      insert into friend_codes (user_id, code)
        values (new.user_id, gen_friend_code())
        on conflict (user_id) do nothing;
      return new;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then return new; end if;
    end;
  end loop;
end;
$$;

-- Trigger function only — never meant to be an RPC. Triggers still fire after
-- this (they run in the table owner's context, not the caller's).
revoke all on function public.assign_friend_code() from public, anon, authenticated;

drop trigger if exists profiles_assign_friend_code on public.profiles;
create trigger profiles_assign_friend_code
  after insert on public.profiles
  for each row execute function public.assign_friend_code();

-- Backfill everyone who already has a profile.
do $$
declare r record;
begin
  for r in
    select p.user_id from public.profiles p
     where not exists (select 1 from public.friend_codes c where c.user_id = p.user_id)
  loop
    begin
      insert into public.friend_codes (user_id, code) values (r.user_id, public.gen_friend_code());
    exception when unique_violation then
      null;  -- rare; opFriendCode will assign lazily
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- blocks
--
-- Honest limit: with anonymous auth a spammer re-registers in one tap, so
-- blocking solves "this specific person keeps adding me" and nothing stronger.
-- The rate limits below are the load-bearing control.
-- ---------------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_user_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id)
);

create index if not exists blocks_blocked_idx on public.blocks (blocked_user_id);

alter table public.blocks enable row level security;

-- Only the blocker sees the row. There is deliberately no policy letting the
-- blocked party discover they were blocked.
drop policy if exists "blocks: read own" on public.blocks;
create policy "blocks: read own"
  on public.blocks for select to authenticated using (blocker_user_id = auth.uid());

drop policy if exists "blocks: add" on public.blocks;
create policy "blocks: add"
  on public.blocks for insert to authenticated with check (blocker_user_id = auth.uid());

drop policy if exists "blocks: remove" on public.blocks;
create policy "blocks: remove"
  on public.blocks for delete to authenticated using (blocker_user_id = auth.uid());

-- Must be security definer: called from the friendships insert policy, where a
-- plain subquery would be filtered by blocks' own RLS (the requester cannot see
-- the row where THEY are the blocked party) and would always return false.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from blocks
     where (blocker_user_id = a and blocked_user_id = b)
        or (blocker_user_id = b and blocked_user_id = a)
  );
$$;

grant execute on function public.is_blocked(uuid, uuid) to authenticated, service_role;

-- Blocking severs the existing relationship in both directions.
create or replace function public.block_cascade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friendships
   where (requester_user_id = new.blocker_user_id and addressee_user_id = new.blocked_user_id)
      or (requester_user_id = new.blocked_user_id and addressee_user_id = new.blocker_user_id);
  delete from room_invites
   where (from_user_id = new.blocker_user_id and to_user_id = new.blocked_user_id)
      or (from_user_id = new.blocked_user_id and to_user_id = new.blocker_user_id);
  return new;
end;
$$;

-- Trigger function only — not an RPC. Triggers still fire after this revoke.
revoke all on function public.block_cascade() from public, anon, authenticated;

drop trigger if exists blocks_cascade on public.blocks;
create trigger blocks_cascade
  after insert on public.blocks
  for each row execute function public.block_cascade();

-- ---------------------------------------------------------------------------
-- rate_limits: hourly counters, shared by friendLookup and friendRequest.
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users (id) on delete cascade,
  bucket       text not null,
  window_start timestamptz not null default date_trunc('hour', now()),
  count        int not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;
-- no policies: edge function (service role) only

-- Returns true when the call is allowed. Counts first, then compares, so the
-- increment is atomic under concurrency.
create or replace function public.rate_limit_hit(p_user uuid, p_bucket text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into rate_limits (user_id, bucket, window_start, count)
    values (p_user, p_bucket, date_trunc('hour', now()), 1)
  on conflict (user_id, bucket, window_start)
    do update set count = rate_limits.count + 1
  returning rate_limits.count into n;
  return n <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(uuid, text, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(uuid, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- friendships: bot auto-decline + rate limits
-- ---------------------------------------------------------------------------

-- Set by opFriendRequest when the target is a hidden bot. A reaper deletes the
-- row when it expires, which realtime pushes to the requester as a plain
-- delete — indistinguishable from a human declining.
alter table public.friendships add column if not exists auto_decline_at timestamptz;

create index if not exists friendships_auto_decline_idx
  on public.friendships (auto_decline_at) where auto_decline_at is not null;

-- The rate-limit subquery below runs on every insert, so the requester index
-- has to cover created_at too.
drop index if exists friendships_requester_idx;
create index if not exists friendships_requester_created_idx
  on public.friendships (requester_user_id, created_at);

-- Enforced at BOTH layers by design. RLS is the hard guarantee — it survives
-- someone hitting PostgREST directly with the anon key that ships in the app.
-- The edge op exists on top of it only for good error messages.
--
-- The count subqueries read the requester's own rows, which "friendships: read
-- own" already permits, so no definer is needed for them.
drop policy if exists "friendships: send" on public.friendships;
create policy "friendships: send" on public.friendships
  for insert to authenticated
  with check (
    requester_user_id = auth.uid()
    and not public.is_blocked(requester_user_id, addressee_user_id)
    and (
      select count(*) from friendships f
       where f.requester_user_id = auth.uid()
         and f.created_at > now() - interval '1 hour'
    ) < 20
    and (
      select count(*) from friendships f
       where f.requester_user_id = auth.uid()
         and f.status = 'pending'
    ) < 50
  );

-- ---------------------------------------------------------------------------
-- room_invites: friends only
--
-- Previously ANY authenticated user could insert a "come play" ping at ANY
-- uid. Audited before landing: the only caller is FriendsScreen's accepted-
-- friends list, so this breaks no existing flow.
-- ---------------------------------------------------------------------------
drop policy if exists "room_invites: send" on public.room_invites;
create policy "room_invites: send" on public.room_invites
  for insert to authenticated
  with check (
    from_user_id = auth.uid()
    and exists (
      select 1 from friendships f
       where f.status = 'accepted'
         and ((f.requester_user_id = auth.uid() and f.addressee_user_id = to_user_id)
           or (f.addressee_user_id = auth.uid() and f.requester_user_id = to_user_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Indexes for "recently played with"
--
-- players' only index is players_game_id_idx (0001:43), so `where user_id = ?`
-- is a seq scan over every player row ever created — a table that only grows.
-- ---------------------------------------------------------------------------
create index if not exists players_user_recent_idx on public.players (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Auto-decline reaper. pg_cron is the primary; the edge function also reaps
-- opportunistically on friend ops, so this is not load-bearing if the
-- extension is unavailable in a given environment (e.g. a local stack).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'friendships-auto-decline',
      '* * * * *',
      $cron$delete from public.friendships where auto_decline_at is not null and auto_decline_at < now()$cron$
    );
  end if;
exception when others then
  null;  -- reaping still happens in the edge function
end $$;

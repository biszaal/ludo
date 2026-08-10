-- Usernames become a real identity: findable by name, and changeable once.
--
-- This supersedes 0015's "Deliberately NOT added: search by display name". That
-- note was never load-bearing: profiles is `select using (true)` (0003:19), so
-- any signed-in client could already enumerate every name through PostgREST.
-- The UI simply didn't offer it. What lands instead is STRICTER than the status
-- quo — an edge op (opFriendSearch) that resolves an EXACT, case-insensitive
-- name to at most one player, on the same hourly throttle as code lookup, with
-- bots excluded and one indistinguishable "not found" for absent/blocked/self.
--
-- Once a name is how people find you, it has to hold still. Hence the one-time
-- change below: a freely-rotating handle makes search useless and makes
-- impersonating a player you just lost coins to trivial.

-- ---------------------------------------------------------------------------
-- One username change, enforced in the database.
--
-- profiles has a self-update policy (0003:26), so the client owns this write
-- and a client-side rule is decoration. Same reasoning — and the same shape —
-- as profiles_enforce_dice_skin: the trigger silently keeps the old value
-- rather than raising, so an avatar or dice edit in the same UPDATE still
-- applies. Rejecting the whole write would let a stale name field block an
-- unrelated cosmetic change.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists name_changed_at timestamptz;

comment on column public.profiles.name_changed_at is
  'When the one allowed username change was spent. Null = still available. '
  'Claiming a name off the minted guestNNNNNN handle does not spend it.';

create or replace function public.enforce_name_change_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role writes carry no JWT (bot creation, backfills, this file's own
  -- dressing steps). Same escape hatch as enforce_dice_skin_ownership (0014:59)
  -- — the rule is about what a PLAYER may do to their own row.
  if auth.uid() is null then
    return new;
  end if;

  -- Same name (case-insensitively) — nothing to police.
  if lower(new.display_name) = lower(old.display_name) then
    return new;
  end if;

  -- Claiming your first real name off this device's minted guest handle is
  -- not a "change" — it's the initial pick. Must stay free, or every player
  -- burns their one allowance on the name they never chose in the first place.
  -- Mirrors makeGuestName() in src/store/profileStore.ts.
  if old.display_name ~ '^guest[0-9]{6}$' then
    new.name_changed_at := old.name_changed_at;
    return new;
  end if;

  -- Allowance already spent: keep the old name, let the rest of the write land.
  if old.name_changed_at is not null then
    new.display_name   := old.display_name;
    new.name_changed_at := old.name_changed_at;
    return new;
  end if;

  new.name_changed_at := now();
  return new;
end;
$$;

-- Trigger function only — never an RPC. Triggers still fire after this revoke
-- (they run as the table owner, not the caller), same as 0015's helpers.
revoke all on function public.enforce_name_change_once() from public, anon, authenticated;

drop trigger if exists profiles_enforce_name_change_once on public.profiles;
create trigger profiles_enforce_name_change_once
  before update on public.profiles
  for each row execute function public.enforce_name_change_once();

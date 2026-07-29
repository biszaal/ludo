-- Dice skins: a per-player cosmetic worn on the profile (like avatar_id) and
-- shown to every player at the table when its owner rolls — the show-off
-- point of buying one. Null = classic, which inherits the viewer's own board
-- theme (dice colors are never a gameplay signal; the roll itself is decided
-- server-side in rollDice, untouched by anything here).

-- 1) The worn skin. Mirrors avatar_id's format exactly; null = classic.
alter table public.profiles add column if not exists dice_skin text;
alter table public.profiles drop constraint if exists profiles_dice_skin_format;
alter table public.profiles add constraint profiles_dice_skin_format
  check (dice_skin is null or dice_skin ~ '^[a-z0-9-]{1,24}$');

-- 2) Let the catalog carry a 'dice' kind alongside 'theme'/'avatar'/'entitlement'.
-- The inline check from 0013 auto-named itself catalog_kind_check; drop +
-- re-add keeps this migration safely re-runnable.
alter table public.catalog drop constraint if exists catalog_kind_check;
alter table public.catalog add constraint catalog_kind_check
  check (kind in ('theme', 'avatar', 'entitlement', 'dice'));

-- 3) Seed. Mirrors DICE_SKINS (apps/mobile/src/render/diceSkins.ts) exactly —
-- a client test parses this file and cross-checks every id/price pair both
-- ways, so keep them in sync when the art changes. Cheap-to-prestige spread:
-- a quick-match win nets ~100-300 coins, so the top tier is a long-horizon
-- flex sink, not a normal purchase.
insert into public.catalog (sku, kind, price, active) values
  ('dice.classic',       'dice', 0,     true),
  ('dice.cherry',        'dice', 400,   true),
  ('dice.mint',          'dice', 400,   true),
  ('dice.midnight',      'dice', 600,   true),
  ('dice.bubblegum',     'dice', 800,   true),
  ('dice.walnut',        'dice', 1500,  true),
  ('dice.marble',        'dice', 2000,  true),
  ('dice.neon',          'dice', 2500,  true),
  ('dice.gold',          'dice', 8000,  true),
  ('dice.galaxy',        'dice', 10000, true),
  ('dice.ember',         'dice', 12000, true),
  ('dice.diamond',       'dice', 40000, true),
  ('dice.obsidian-king', 'dice', 75000, true)
on conflict (sku) do nothing;

-- 4) Ownership enforcement. High-value skins (up to 75,000 coins) are worth
-- spoofing in a way the free-starter avatars never were, so unlike avatar_id
-- the worn value is checked against entitlements on every write. A modded
-- client that sets dice_skin to a priced sku it doesn't own gets the field
-- silently cleared — NEVER an exception: this trigger rides the same upsert
-- that also carries display_name, and profile sync must never block or break
-- play (see net/profileSync.ts). Service-role writes (bot creation, this
-- migration's own dressing step below) carry no JWT — auth.uid() is null —
-- and pass through untouched.
create or replace function public.enforce_dice_skin_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  skin_price int;
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.dice_skin is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.dice_skin is not distinct from old.dice_skin then
    return new;
  end if;

  select price into skin_price
    from catalog
   where sku = 'dice.' || new.dice_skin
     and active;

  -- Not in the (seeded) catalog, or free: nothing to enforce. Forward-compat
  -- matters here — an older migration's client resolving a not-yet-seeded
  -- skin id must not have its whole profile write rejected.
  if skin_price is null or skin_price = 0 then
    return new;
  end if;

  if exists (
    select 1 from entitlements
     where user_id = new.user_id
       and sku = 'dice.' || new.dice_skin
  ) then
    return new;
  end if;

  new.dice_skin := null;
  return new;
end;
$$;

drop trigger if exists profiles_enforce_dice_skin on public.profiles;
create trigger profiles_enforce_dice_skin
  before insert or update on public.profiles
  for each row execute function public.enforce_dice_skin_ownership();

-- 5) One-time dress of the existing hidden-bot pool. Service-role context, so
-- the trigger above passes it through untouched. Mostly classic/cheap — the
-- default skin staying common on both humans and bots is what keeps it from
-- being a tell (see BOT_DICE_SKINS in supabase/functions/game/index.ts, which
-- assigns newly minted bots their skin the same weighted way going forward).
update public.profiles p
   set dice_skin = case
     when b.r < 0.55 then null
     when b.r < 0.70 then 'cherry'
     when b.r < 0.80 then 'mint'
     when b.r < 0.88 then 'midnight'
     when b.r < 0.93 then 'bubblegum'
     when b.r < 0.97 then 'walnut'
     else 'neon'
   end
  from (select user_id, random() as r from public.bot_identities) b
 where p.user_id = b.user_id;

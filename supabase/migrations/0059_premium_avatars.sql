-- Seven premium avatars: the Regalia line priced in coins, the Celestial line
-- priced in gems.
--
-- Why now. The face catalog stopped at 500 coins (0013) while the dice catalog
-- climbs to 75,000 (0014's obsidian-king). A player with 40,000 coins had
-- something to want on the dice shelf and nothing at all on the avatar shelf,
-- which is a strange thing to say to the player who has played the most. This
-- fills that gap on the shelf people actually look at: the avatar is the only
-- cosmetic every opponent sees on every turn.
--
-- The art is drawn, not tinted. Each of these carries a metal gradient (the
-- first in the catalog — scripts/gen-avatars.mjs grew a linear-gradient paint
-- for them) and a silhouette no other chip has: a laurel wreath, a winged
-- helm, a nemes headdress, a jewelled crown, a star circlet, a crescent, a
-- sunburst. That is deliberate, and it is 0045's lesson applied to faces: a
-- prestige tier assembled out of recolors is the one players stop believing
-- in first. Two lines that look nothing like each other also give a player a
-- reason to want both, where eight variations of gold give them a reason to
-- want one.
--
-- The jewels are amethyst and diamond throughout, never ruby/emerald/sapphire.
-- The four seats own red, green, yellow and blue, so a red stone worn on a
-- face is a seat colour on a player — exactly the confusion the chip tones in
-- 0018 were designed away from. Violet is the widest gap the seat hues leave
-- and a colourless stone has no hue to clash at all.
--
-- Coin ladder: 3,000 / 12,000 / 40,000 / 100,000. It tracks the dice ladder's
-- shape (8k/12k/40k/75k) rather than inventing a second curve, and stretches
-- it — a quick-match win nets ~100-300 coins, so laurel is a couple of good
-- sessions and regis is a long-horizon flex nobody buys by accident.
--
-- Gem ladder: 260 / 420 / 600, continuing 0044/0045's gem line rather than
-- resetting it, and topping out at the same 600 as dice.sovereign — under the
-- 750-gem pack, so the top of the line stays reachable by a player who buys
-- once. A ceiling nobody can touch is not a target, it is decoration on a
-- price list.
--
-- Still appearance only. Same fairness invariant as 0013/0018/0027/0044/0045:
-- coins and gems buy ACCESS and APPEARANCE, never an outcome. The engine has
-- no idea which face a seat is wearing.
--
-- Parity with the client registry (apps/mobile/src/render/avatars.ts) is
-- test-enforced in both directions by __tests__/avatars.test.ts and
-- __tests__/gemCatalog.test.ts, which scan every migration in this directory.

insert into public.catalog (sku, kind, price, currency, active) values
  -- Regalia (coins)
  ('avatar.laurel', 'avatar', 3000,   'coins', true),
  ('avatar.saga',   'avatar', 12000,  'coins', true),
  ('avatar.pharo',  'avatar', 40000,  'coins', true),
  ('avatar.regis',  'avatar', 100000, 'coins', true),
  -- Celestial (gems)
  ('avatar.astra',  'avatar', 260, 'gems', true),
  ('avatar.selene', 'avatar', 420, 'gems', true),
  ('avatar.solis',  'avatar', 600, 'gems', true)
on conflict (sku) do nothing;

-- 2. Grandfather the players already wearing a priced avatar -----------------
--
-- Measured on production before writing this: 91 profiles wore a priced avatar
-- with no matching entitlement row. 79 are hidden bots, which the trigger below
-- never touches (service-role writes have no auth.uid()). The other 12 are real
-- players, one of them wearing nova, a 100-gem face.
--
-- That drift is the fail-open documented in lib/cosmetics.ts: for a while the
-- client treated a sku the catalog had not answered for as owned. None of these
-- players did anything wrong, and section 3 is about stopping spoofing, not
-- about confiscating faces people have been wearing for months. So they are
-- granted what they already wear, once, before the rule starts applying.
--
-- After this, "wearing implies owning" holds for every real player, which makes
-- section 3's OLD.avatar_id fallback a genuine safety net rather than permanent
-- grandfathering built into the trigger.
--
-- Bot membership comes from bot_identities, not auth.users.is_anonymous: a
-- guest who has secured their account is no longer anonymous but is still a
-- real player, and misreading one as a bot is how you strip a paying customer.
insert into public.entitlements (user_id, sku, source)
select p.user_id, 'avatar.' || p.avatar_id, 'grant'
  from public.profiles p
  join public.catalog c
    on c.sku = 'avatar.' || p.avatar_id
   and c.active
   and c.price > 0
 where not exists (select 1 from public.bot_identities b where b.user_id = p.user_id)
   and not exists (select 1 from public.entitlements e
                    where e.user_id = p.user_id
                      and e.sku = 'avatar.' || p.avatar_id)
on conflict (user_id, sku) do nothing;

-- 3. Ownership enforcement for the worn avatar ------------------------------
--
-- 0014 gave dice_skin an ownership trigger and said why avatar_id did not get
-- one: "High-value skins (up to 75,000 coins) are worth spoofing in a way the
-- free-starter avatars never were." That was true of a catalog whose dearest
-- face cost 500 coins. Section 1 above makes the dearest face cost 100,000,
-- which retires the premise — and an avatar is worn where every opponent sees
-- it every turn, so it is the more attractive thing to spoof, not the less.
-- Without this, a modded client wears regis for nothing and the player who
-- actually ground 100,000 coins for it is holding a receipt for wallpaper.
--
-- Two deliberate differences from the dice trigger:
--
--   * It falls back to OLD.avatar_id on update, not to a fixed default. The
--     dice column is nullable so clearing it means "classic"; avatar_id is NOT
--     NULL, and resetting an existing wearer to 'leo' would take a face off
--     someone's profile on their next routine sync. Any player whose
--     entitlement row drifted historically (see the fail-open note in
--     lib/cosmetics.ts) would lose the avatar they have worn for months. So
--     the rule is narrower and safer: you may not CHANGE INTO an avatar you do
--     not own. What you are already wearing is left alone.
--
--   * Insert has no OLD row to fall back to, so it takes DEFAULT_AVATAR_ID
--     ('leo', free, and what resolveAvatarId returns for anything unknown).
--
-- Same discipline as 0014 otherwise: never raise, only correct. This trigger
-- rides the same upsert that carries display_name, and profile sync must never
-- block or break play (see net/profileSync.ts). Service-role writes — bot
-- creation, 0040's bot dressing step — carry no JWT, so auth.uid() is null and
-- they pass through untouched.
create or replace function public.enforce_avatar_ownership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  avatar_price int;
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.avatar_id is not distinct from old.avatar_id then
    return new;
  end if;

  select price into avatar_price
    from catalog
   where sku = 'avatar.' || new.avatar_id
     and active;

  -- Not in the (seeded) catalog, or free: nothing to enforce. Forward-compat
  -- matters here exactly as it does for dice — a newer client resolving an
  -- avatar id this database has not been seeded with yet must not have its
  -- whole profile write rejected, and legacy ids like 'orbit-moss' are not
  -- catalog skus at all.
  if avatar_price is null or avatar_price = 0 then
    return new;
  end if;

  if exists (
    select 1 from entitlements
     where user_id = new.user_id
       and sku = 'avatar.' || new.avatar_id
  ) then
    return new;
  end if;

  new.avatar_id := case when tg_op = 'UPDATE' then old.avatar_id else 'leo' end;
  return new;
end;
$$;

revoke all on function public.enforce_avatar_ownership() from public, anon, authenticated;

drop trigger if exists profiles_enforce_avatar on public.profiles;
create trigger profiles_enforce_avatar
  before insert or update on public.profiles
  for each row execute function public.enforce_avatar_ownership();

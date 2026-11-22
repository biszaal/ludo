-- 0087: the spin payout key names the player.
--
-- 0086 paid spins under ext_id 'spin:<request_id>'. wallet_txns and gem_txns
-- treat ext_id as unique across ALL players, while spin_log is keyed per
-- player. So a request id reused by a second account (the app can do this: an
-- unanswered claim's id is retried, and the account can change in between)
-- would log the second player's spin as paid while wallet_apply quietly
-- credited nothing. The key is now 'spin:<user>:<request_id>'.
--
-- Applied before any spin was taken (spin_log was empty, the feature off), so
-- no row carries the old format. Only spin_claim changes.

create or replace function public.spin_claim(
  p_user       uuid,
  p_source     text,
  p_request_id uuid,
  p_now        timestamptz default now(),
  p_roll       int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg    jsonb := public.spin_config();
  v_today  date := (p_now at time zone 'utc')::date;
  v_prior  spin_log%rowtype;
  v_status jsonb;
  v_owed   boolean;
  v_wheel  text;
  v_segs   jsonb;
  v_total  int;
  v_roll   int;
  v_pick   int;
  v_acc    int := 0;
  v_seg    jsonb;
  v_cap    int;
  v_spent  int;
  v_coins  int := 0;
  v_gems   int := 0;
  v_bal    int;
  v_gbal   int;
begin
  -- Lock the player's wallet first, so two calls for the same player (a
  -- double tap, a retry racing its own original) run one after the other: the
  -- second then sees the first's log row below instead of racing it.
  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  perform 1 from wallets where user_id = p_user for update;

  -- A retry of a request that already paid gets the same answer, even if the
  -- feature was switched off in between.
  select * into v_prior from spin_log where user_id = p_user and request_id = p_request_id;
  if found then
    select balance, gems into v_bal, v_gbal from wallets where user_id = p_user;
    return jsonb_build_object(
      'ok', true,
      'wheel', v_prior.wheel,
      'segments', public.spin_table(v_prior.wheel),
      'segment', v_prior.segment,
      'prize', case when v_prior.gems > 0 then jsonb_build_object('gems', v_prior.gems)
                    else jsonb_build_object('coins', v_prior.coins) end,
      'balance', v_bal,
      'gems', v_gbal,
      'status', public.spin_status(p_user, p_now));
  end if;

  if p_source is null or p_source not in ('daily', 'first', 'match') then
    return jsonb_build_object('ok', false, 'reason', 'bad_source');
  end if;
  if not public.spin_enabled(p_user) then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  v_status := public.spin_status(p_user, p_now);
  -- The switch can flip between spin_enabled() above and this read: trust the
  -- read that decides, and fail closed on anything that isn't a clear yes.
  if v_status->'enabled' is distinct from 'true'::jsonb then
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;
  v_owed := case p_source
    when 'first' then v_status->'owed'->>'first' = 'owed'
    when 'daily' then (v_status->'owed'->>'daily')::boolean
    else (v_status->'owed'->>'match')::int > 0
  end;
  if v_owed is not true then
    return jsonb_build_object('ok', false, 'reason', 'not_owed');
  end if;

  v_wheel := case p_source when 'first' then 'firstGame' when 'daily' then v_status->>'tier' else 'bronze' end;
  v_segs := public.spin_table(v_wheel);
  select coalesce(sum((s->>'w')::int), 0) into v_total from jsonb_array_elements(v_segs) s;
  if v_total <= 0 then
    -- A wheel with no weights is a broken config: treat it as switched off.
    return jsonb_build_object('ok', false, 'reason', 'disabled');
  end if;

  -- gen_random_uuid() is pg_strong_random; its first 8 hex digits are fully random.
  v_roll := coalesce(p_roll,
    (('x' || lpad(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8), 16, '0'))::bit(64)::bigint
      % v_total)::int);
  v_roll := ((v_roll % v_total) + v_total) % v_total;
  for i in 0 .. jsonb_array_length(v_segs) - 1 loop
    v_acc := v_acc + (v_segs->i->>'w')::int;
    if v_roll < v_acc then
      v_pick := i;
      exit;
    end if;
  end loop;
  v_seg := v_segs->v_pick;

  -- The daily coin cap: a coin prize that would carry today's spin coins past
  -- it becomes the largest coin prize on this wheel that still fits (or the
  -- smallest, if none does). Reported as that segment, so the wheel agrees.
  if v_seg ? 'coins' then
    v_cap := case when jsonb_typeof(v_cfg->'dailyCoinCap') = 'number' then (v_cfg->>'dailyCoinCap')::int else 1500 end;
    select coalesce(sum(coins), 0) into v_spent from spin_log where user_id = p_user and day = v_today;
    if v_spent + (v_seg->>'coins')::int > v_cap then
      select coalesce(
        (select (t.ord - 1)::int from jsonb_array_elements(v_segs) with ordinality t(s, ord)
          where t.s ? 'coins' and v_spent + (t.s->>'coins')::int <= v_cap
          order by (t.s->>'coins')::int desc, t.ord limit 1),
        (select (t.ord - 1)::int from jsonb_array_elements(v_segs) with ordinality t(s, ord)
          where t.s ? 'coins'
          order by (t.s->>'coins')::int asc, t.ord limit 1))
        into v_pick;
      v_seg := v_segs->v_pick;
    end if;
  end if;

  if v_seg ? 'gems' then
    v_gems := (v_seg->>'gems')::int;
    perform public.gem_apply(p_user, v_gems, 'spin-' || p_source, 'spin:' || p_user::text || ':' || p_request_id::text);
  else
    v_coins := (v_seg->>'coins')::int;
    perform public.wallet_apply(p_user, v_coins, 'spin-' || p_source, null::uuid, 'earned',
                                'spin:' || p_user::text || ':' || p_request_id::text);
  end if;

  insert into spin_log (user_id, day, source, wheel, table_version, segment, coins, gems, request_id)
  values (p_user, v_today, p_source, v_wheel, coalesce((v_cfg->>'tableVersion')::int, 1),
          v_pick, v_coins, v_gems, p_request_id);

  select balance, gems into v_bal, v_gbal from wallets where user_id = p_user;
  -- The wheel actually drawn from goes back with the result: the app animates
  -- on these segments, not the ones it showed before the tap, so a tier that
  -- changed at the reset (or a gems switch) can never land on the wrong prize.
  return jsonb_build_object(
    'ok', true,
    'wheel', v_wheel,
    'segments', v_segs,
    'segment', v_pick,
    'prize', case when v_gems > 0 then jsonb_build_object('gems', v_gems) else jsonb_build_object('coins', v_coins) end,
    'balance', v_bal,
    'gems', v_gbal,
    'status', public.spin_status(p_user, p_now));
end;
$$;

revoke all on function public.spin_claim(uuid, text, uuid, timestamptz, int) from public, anon, authenticated;
grant execute on function public.spin_claim(uuid, text, uuid, timestamptz, int) to service_role;

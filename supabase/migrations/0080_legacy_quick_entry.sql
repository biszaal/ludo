-- Keep installed apps matching through the funded quick-match transaction.
--
-- Apply after 0077. 0077 made quick_match_enter require a client request key,
-- and every build up to 1.2.3 sends quickMatch without one. Measured on
-- 2026-11-15: about one online player in five was still on 1.2.2 or older, and
-- the app has no forced-update mechanism, so "old clients get an upgrade
-- message" would have switched quick match off for them until they happened to
-- update. Splitting them onto the old non-atomic path is not an option either:
-- that is the money path 0076/0077 exist to retire.
--
-- A keyless request is safe here because the double-charge guard does not live
-- in the key. The "already seated in a waiting or live quick room" branch below
-- resumes that seat whatever key arrives, which is the same one-search-at-a-time
-- rule the pre-0077 server enforced and the only retry protection old apps ever
-- relied on (their quickMatch retries automatically). What a key ADDS is the
-- replay answer for a search that has since ended — "That search has ended"
-- instead of a fresh search. Old apps never had that, so they keep their old
-- behaviour there: a late retry after a cancel starts a new, separately funded
-- and separately refundable search.
--
-- The keyless entry is still recorded, under 'legacy:' || player_id. It is
-- derived from the seat the request created, so it is unique per funded entry
-- and never a fresh random key per retry. A keyless RESUME records nothing new.
--
-- Keyed requests are unchanged, including the length check.

create or replace function public.quick_match_enter(p_user uuid, p_size int, p_stake int, p_mode text,
  p_app_version text, p_request text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g games%rowtype;
  prior quick_match_requests%rowtype;
  pid uuid;
  chair int;
  purchased_before int;
  purchased_after int;
  balance_after int;
  attempt int;
  created boolean := false;
begin
  if p_size not in (2,4) or p_stake <= 0 or p_mode not in ('classic','blitz')
     or (p_request is not null and length(p_request) not between 8 and 128) then
    raise exception 'Invalid matchmaking request';
  end if;
  -- Serializes multiple devices searching on the same account.
  perform pg_advisory_xact_lock(hashtextextended('quick-user:' || p_user, 0));
  if p_request is not null then
    select * into prior from quick_match_requests where user_id=p_user and request_key=p_request;
  end if;
  if p_request is not null and found then
    select * into g from games where id=prior.game_id for update;
    if not found or not exists(select 1 from players where id=prior.player_id and game_id=g.id) then
      return jsonb_build_object('error','That search has ended. Start a new search.');
    end if;
    pid := prior.player_id;
  else
    -- A new tap while seated also resumes that room instead of charging again.
    -- For a keyless (pre-0077) app this is the whole retry guard.
    select games.* into g from games join players p on p.game_id=games.id
      where p.user_id=p_user and games.is_quick and
      (games.status='waiting' or (games.status='active' and exists(
        select 1 from jsonb_array_elements(games.state->'players') s
          where s->>'userId'=p_user::text and coalesce((s->>'hasLeft')::boolean,false)=false)))
      order by games.created_at desc limit 1 for update of games;
    if found then
      if not g.atomic_quick then
        return jsonb_build_object('error','Finish or cancel your previous match before searching again.');
      end if;
      select id into pid from players where game_id=g.id and user_id=p_user;
    else
      -- Pool lock also covers the empty-pool case, so simultaneous arrivals do
      -- not each create an isolated room. Lock order: pool -> game -> wallets.
      perform pg_advisory_xact_lock(hashtextextended('quick-pool:' || p_size || ':' || p_stake || ':' || p_mode,0));
      select * into g from games where is_quick and atomic_quick and status='waiting'
        and quick_size=p_size and stake=p_stake and mode=p_mode
        and (select count(*) from players where game_id=games.id)<p_size
        order by created_at limit 1 for update;
      if not found then
        for attempt in 1..8 loop
          begin
            insert into games(room_code,host_user_id,is_quick,atomic_quick,quick_size,stake,mode)
              values((select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',1+floor(random()*31)::int,1),'') from generate_series(1,4)),p_user,true,true,p_size,p_stake,p_mode)
              returning * into g;
            exit;
          exception when unique_violation then
            if attempt=8 then raise; end if;
          end;
        end loop;
      end if;
      select n into chair from generate_series(0,p_size-1) n
        where not exists(select 1 from players where game_id=g.id and seat=n) order by n limit 1;
      if chair is null then raise exception 'Queue is full'; end if;
      insert into players(game_id,user_id,color,seat,is_host,app_version)
        values(g.id,p_user,case when p_size=2 then (array['red','yellow'])[chair+1]
          else (array['red','green','yellow','blue'])[chair+1] end,chair,g.host_user_id=p_user,p_app_version)
        returning id into pid;
      insert into wallets(user_id) values(p_user) on conflict do nothing;
      select purchased_balance into purchased_before from wallets where user_id=p_user for update;
      balance_after := wallet_apply(p_user,-p_stake,'stake',g.id,'earned','quick-entry:' || pid);
      if balance_after is null then raise exception 'Not enough coins for this match.' using errcode='LD002'; end if;
      select purchased_balance into purchased_after from wallets where user_id=p_user;
      insert into quick_entries(player_id,game_id,user_id,amount,purchased_spent)
        values(pid,g.id,p_user,p_stake,purchased_before-purchased_after);
      update games set state_version=state_version+1 where id=g.id returning * into g;
      created := true;
    end if;
    if p_request is not null then
      insert into quick_match_requests(user_id,request_key,game_id,player_id) values(p_user,p_request,g.id,pid);
    elsif created then
      insert into quick_match_requests(user_id,request_key,game_id,player_id)
        values(p_user,'legacy:' || pid,g.id,pid);
    end if;
  end if;
  return jsonb_build_object('gameId',g.id,'playerId',pid,'waiting',g.status='waiting',
    'state',g.state,'v',g.state_version,'size',g.quick_size,'stake',g.stake,'mode',g.mode,
    'seated',(select count(*) from players where game_id=g.id));
end;
$$;
revoke all on function public.quick_match_enter(uuid,int,int,text,text,text) from public,anon,authenticated;
grant execute on function public.quick_match_enter(uuid,int,int,text,text,text) to service_role;

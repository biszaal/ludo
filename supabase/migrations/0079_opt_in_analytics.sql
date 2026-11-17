-- Product measurement is optional and separate from ads consent.
create table public.product_analytics_consent (
 user_id uuid primary key references auth.users(id) on delete cascade,
 enabled boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.product_events (
 user_id uuid not null references auth.users(id) on delete cascade,
 event_key text not null check(length(event_key) between 1 and 128),
 event_name text not null check(event_name in ('session_started','match_started','match_completed','matchmaking_cancelled','reconnect','invite_shared','invite_joined','purchase_delivered','rewarded_ad_delivered')),
 created_at timestamptz not null default now(),
 primary key(user_id,event_key)
);
create index product_events_created on public.product_events(created_at);
create index product_events_user_time on public.product_events(user_id,created_at);
alter table public.product_events enable row level security;
alter table public.product_analytics_consent enable row level security;
revoke all on public.product_events,public.product_analytics_consent from public,anon,authenticated;
grant select,delete on public.product_events to service_role;
grant select on public.product_analytics_consent to service_role;

create function public.set_product_analytics_consent(p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid := auth.uid();
begin
 if actor is null or p_enabled is null then raise exception 'Authentication and consent required'; end if;
 insert into product_analytics_consent(user_id,enabled) values(actor,p_enabled)
 on conflict(user_id) do update set enabled=excluded.enabled,updated_at=now();
 -- The row lock serializes withdrawal with collection. Opt-out deletes history.
 if not p_enabled then delete from product_events where user_id=actor; end if;
end;
$$;
create function public.record_product_event(p_name text,p_key text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid := auth.uid(); permitted boolean;
begin
 if actor is null then return false; end if;
 select enabled into permitted from product_analytics_consent where user_id=actor for update;
 if permitted is distinct from true then return false; end if;
 if (select count(*) from product_events where user_id=actor and created_at>now()-interval '1 minute') >= 60 then return false; end if;
 insert into product_events(user_id,event_key,event_name) values(actor,p_key,p_name) on conflict do nothing;
 return true;
end;
$$;
revoke all on function public.set_product_analytics_consent(boolean),public.record_product_event(text,text) from public,anon;
grant execute on function public.set_product_analytics_consent(boolean),public.record_product_event(text,text) to authenticated;
-- Retention is scheduled with pg_cron on Supabase, absent in focused test DBs.
do $$ begin
 if exists(select 1 from pg_namespace where nspname='cron') then
  perform cron.schedule('product-event-retention','25 3 * * *', $job$delete from public.product_events where created_at < now()-interval '90 days'$job$);
 end if;
end $$;

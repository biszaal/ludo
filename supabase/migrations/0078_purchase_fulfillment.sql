-- A delivery receipt must commit with the grant, never before it.
alter table public.iap_purchases add column fulfillment_verified boolean not null default false;

create table public.iap_review_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);
alter table public.iap_review_events enable row level security;
revoke all on public.iap_review_events from public, anon, authenticated;
grant select, insert, update on public.iap_review_events to service_role;

create or replace function public.fulfill_iap(
  p_user uuid, p_product text, p_provider text, p_txn text,
  p_gems integer, p_noads boolean default false
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  receipt public.iap_purchases%rowtype;
  ledger public.gem_txns%rowtype;
  balance integer;
begin
  if p_user is null or p_provider not in ('appstore','play') or
     coalesce(length(p_txn),0) not between 1 and 512 or
     coalesce(length(p_product),0) not between 1 and 256 or
     p_gems is null or p_noads is null or
     (p_noads and p_gems <> 0) or (not p_noads and p_gems <= 0) then
    raise exception 'Invalid purchase';
  end if;
  -- Same key as the historical gem ledger: cross-store collisions must fail
  -- visibly rather than reattribute an old credit to another account.
  perform pg_advisory_xact_lock(hashtextextended('rc:' || p_txn, 0));
  select * into receipt from iap_purchases
    where provider=p_provider and provider_txn_id=p_txn for update;
  if found and (receipt.user_id <> p_user or receipt.product_id <> p_product) then
    raise exception 'Purchase ownership conflict';
  end if;
  if receipt.fulfillment_verified then
    return jsonb_build_object('delivered',true,'gems',receipt.gems);
  end if;
  if p_noads then
    insert into entitlements(user_id,sku,source) values(p_user,'noads','iap')
      on conflict(user_id,sku) do nothing;
  else
    select * into ledger from gem_txns where ext_id='rc:' || p_txn;
    if found then
      if ledger.user_id <> p_user or ledger.delta <> p_gems or ledger.reason <> 'iap' then
        raise exception 'Purchase ledger conflict';
      end if;
    else
      balance := gem_apply(p_user,p_gems,'iap','rc:' || p_txn);
      if balance is null then raise exception 'Purchase credit failed'; end if;
      -- An old webhook worker may not take our advisory lock. Verify the
      -- unique ledger winner even when gem_apply resolved a concurrent replay.
      select * into ledger from gem_txns where ext_id='rc:' || p_txn;
      if not found or ledger.user_id <> p_user or ledger.delta <> p_gems or ledger.reason <> 'iap' then
        raise exception 'Purchase ledger conflict';
      end if;
    end if;
  end if;
  if receipt.id is null then
    insert into iap_purchases(user_id,product_id,gems,provider,provider_txn_id,status,credited_at,fulfillment_verified)
      values(p_user,p_product,p_gems,p_provider,p_txn,'credited',now(),true);
  else
    update iap_purchases set status='credited',gems=p_gems,
      credited_at=coalesce(credited_at,now()),fulfillment_verified=true where id=receipt.id;
  end if;
  return jsonb_build_object('delivered',true,'gems',p_gems);
end;
$$;
revoke all on function public.fulfill_iap(uuid,text,text,text,integer,boolean) from public, anon, authenticated;
grant execute on function public.fulfill_iap(uuid,text,text,text,integer,boolean) to service_role;

-- Backfill only receipts proven by their own ledger. Never trust the old
-- best-effort status flag or infer delivery from a user's current balance.
update public.iap_purchases p set fulfillment_verified=true
from public.gem_txns g where p.status='credited' and p.gems>0
  and g.ext_id='rc:' || p.provider_txn_id and g.user_id=p.user_id
  and g.delta=p.gems and g.reason='iap';

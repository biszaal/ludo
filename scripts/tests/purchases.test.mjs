import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const sql = n => readFile(new URL(`../../supabase/migrations/${n}`, import.meta.url),'utf8');
const user='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const query=async (s,a=[]) => (await db.query(s,a)).rows;
const fulfill=(u=user,gems=60,noads=false,product='gems.small') => query('select fulfill_iap($1,$2,$3,$4,$5,$6)',[u,product,'appstore','tx-1',gems,noads]);
before(async()=>{
 db=await PGlite.create();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create table wallets(user_id uuid primary key references auth.users(id), gems int not null default 0, updated_at timestamptz default now());
 create table entitlements(user_id uuid references auth.users(id),sku text,source text,primary key(user_id,sku));`);
 // Real gem ledger/function and receipt schema; unrelated queue routines are
 // omitted from this focused fixture. Full migration replay requires Supabase.
 const gems=await sql('0018_gems.sql');
 await db.exec(gems.slice(gems.indexOf('create table if not exists public.gem_txns'),gems.indexOf('-- 3.')));
 await db.exec(gems.slice(gems.indexOf('create table if not exists public.iap_purchases'),gems.indexOf('-- 5.')));
 await db.exec(await sql('0063_remove_ads_iap.sql'));
 await db.exec(await sql('0078_purchase_fulfillment.sql'));
});
after(async()=>await db?.close());
beforeEach(async()=>{
 await db.exec('truncate auth.users cascade');
 await query('insert into auth.users values($1),($2)',[user,other]);
});
test('fulfillment credits once and commits a verified receipt',async()=>{
 await fulfill(); await fulfill();
 assert.equal((await query('select gems from wallets'))[0].gems,60);
 assert.equal((await query('select * from gem_txns')).length,1);
 assert.equal((await query('select fulfillment_verified from iap_purchases'))[0].fulfillment_verified,true);
});
test('receipt failure rolls back both currency and ledger',async()=>{
 await db.exec(`create function reject_receipt() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
 create trigger fail_receipt before insert on iap_purchases for each row execute function reject_receipt();`);
 try { await assert.rejects(fulfill(),/injected/); }
 finally {await db.exec('drop trigger fail_receipt on iap_purchases; drop function reject_receipt();');}
 assert.equal((await query('select * from wallets')).length,0);
 assert.equal((await query('select * from gem_txns')).length,0);
 await fulfill();
});
test('historical false credited flag is repaired by actual fulfillment',async()=>{
 await query("insert into iap_purchases(user_id,product_id,gems,provider,provider_txn_id,status) values($1,'gems.small',60,'appstore','tx-1','credited')",[user]);
 await fulfill();
 assert.equal((await query('select gems from wallets'))[0].gems,60);
 assert.equal((await query('select fulfillment_verified from iap_purchases'))[0].fulfillment_verified,true);
});
test('historical ledger credit is adopted without crediting again',async()=>{
 await query("select gem_apply($1,60,'iap','rc:tx-1')",[user]);
 await fulfill();
 assert.equal((await query('select gems from wallets'))[0].gems,60);
});
test('transaction cannot be reassigned to another user or product',async()=>{
 await fulfill();
 await assert.rejects(fulfill(other),/ownership conflict/);
 await assert.rejects(fulfill(user,60,false,'different'),/ownership conflict/);
 assert.equal((await query('select count(*)::int n from wallets'))[0].n,1);
});
test('legacy ledger ownership conflicts do not produce a verified receipt',async()=>{
 await query("select gem_apply($1,60,'iap','rc:tx-1')",[other]);
 await assert.rejects(fulfill(),/ledger conflict/);
 assert.equal((await query('select * from iap_purchases')).length,0);
});
test('noads grants entitlement and receipt atomically',async()=>{
 await fulfill(user,0,true,'noads'); await fulfill(user,0,true,'noads');
 assert.equal((await query('select * from entitlements')).length,1);
 assert.equal((await query('select * from gem_txns')).length,0);
 assert.equal((await query('select fulfillment_verified from iap_purchases'))[0].fulfillment_verified,true);
});
test('client roles cannot fulfill or inspect refund review events',async()=>{
 for(const role of ['anon','authenticated']) {
  assert.equal((await query("select has_function_privilege($1,'public.fulfill_iap(uuid,text,text,text,integer,boolean)','execute') ok",[role]))[0].ok,false);
  assert.equal((await query("select has_table_privilege($1,'public.iap_review_events','select') ok",[role]))[0].ok,false);
 }
});

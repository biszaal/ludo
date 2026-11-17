import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const user='00000000-0000-4000-8000-000000000001';
const q=async s=>(await db.query(s)).rows;
before(async()=>{
 db=await PGlite.create();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 insert into auth.users values('${user}');set request.jwt.claim.sub='${user}';`);
 await db.exec(await readFile(new URL('../../supabase/migrations/0079_opt_in_analytics.sql',import.meta.url),'utf8'));
});
after(async()=>await db?.close());
beforeEach(async()=>await db.exec('truncate product_events,product_analytics_consent'));
test('default consent refuses collection without creating an event',async()=>{
 assert.equal((await q("select record_product_event('session_started','one') ok"))[0].ok,false);
 assert.equal((await q('select count(*)::int n from product_events'))[0].n,0);
});
test('opt-in records once, withdrawal deletes history and blocks future events',async()=>{
 await q('select set_product_analytics_consent(true)');
 for(let i=0;i<2;i++) await q("select record_product_event('session_started','one')");
 assert.equal((await q('select count(*)::int n from product_events'))[0].n,1);
 await q('select set_product_analytics_consent(false)');
 assert.equal((await q('select count(*)::int n from product_events'))[0].n,0);
 assert.equal((await q("select record_product_event('session_started','two') ok"))[0].ok,false);
});
test('free-form event names and oversized keys are rejected',async()=>{
 await q('select set_product_analytics_consent(true)');
 await assert.rejects(q("select record_product_event('a chat message','one')"),/check constraint/);
 await assert.rejects(q("select record_product_event('session_started',repeat('x',129))"),/check constraint/);
});
test('authenticated callers cannot bypass consent or read event history directly',async()=>{
 for(const table of ['product_events','product_analytics_consent']) {
  for(const action of ['insert','update','select']) assert.equal((await q(`select has_table_privilege('authenticated','${table}','${action}') ok`))[0].ok,false);
 }
 assert.equal((await q("select has_function_privilege('anon','record_product_event(text,text)','execute') ok"))[0].ok,false);
});

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { economySchema } from './helpers/economySchema.mjs';

// Contract tests for the referral programme (0082): who can be referred, when a
// referral pays, that it pays once, and the inviter caps. Times that matter to
// the Nepal-day and 8-hour rules are passed explicitly as p_now so the tests do
// not depend on the hour they run at.
let db;
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const one = async (text, args = []) => (await query(text, args))[0];

const A = uid(1); // inviter
const B = uid(2); // invitee
const C = uid(3);

const user = (id, createdAt = 'now()') =>
  query(`insert into auth.users(id, created_at) values ($1, ${createdAt})`, [id]);
const games = (id, n) =>
  query('insert into player_stats(user_id, games_played) values ($1, $2) on conflict (user_id) do update set games_played = excluded.games_played', [id, n]);
const enable = (over = {}) =>
  query("insert into app_config(key, value) values ('default', $1) on conflict (key) do update set value = excluded.value",
    [JSON.stringify({ economy: { referral: { enabled: true, ...over } } })]);
const attach = async (invitee, inviter, source = 'code') =>
  (await one('select referral_attach($1, $2, $3) r', [invitee, inviter, source])).r;
const settle = async (invitee, now = null) =>
  (await one(now ? 'select referral_settle($1, $2::timestamptz) r' : 'select referral_settle($1) r', now ? [invitee, now] : [invitee])).r;
const list = async (id) => (await one('select referral_list($1) r', [id])).r;
const rows = () => query('select inviter_user_id, invitee_user_id, source, status from referrals order by created_at');
const credits = () => query("select user_id, delta, reason, ext_id from wallet_txns where reason like 'referral-%' order by reason");

before(async () => {
  db = await PGlite.create();
  await db.exec(await economySchema());
  await db.exec(`
    alter table auth.users add column created_at timestamptz not null default now();
    create table bot_identities(user_id uuid primary key);
    create table app_config(key text primary key, value jsonb not null);
    create table profiles(user_id uuid primary key, display_name text, avatar_id text);
    create table friend_codes(user_id uuid primary key, code text unique);
  `);
  await db.exec(await migration('0082_referrals.sql'));
  // 0084 replaces referral_settle (device rule); every test here runs against it.
  await db.exec(await migration('0084_install_and_device.sql'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate user_devices, install_sources, friend_codes, referrals, wallets, wallet_txns, player_stats, bot_identities, app_config, profiles, auth.users cascade;');
  await user(A, "now() - interval '30 days'");
});

test('attach records a code referral for a new player', async () => {
  await enable();
  await user(B);
  assert.deepEqual(await attach(B, A), { attached: true, inviteeCoins: 100, gamesRequired: 2 });
  assert.deepEqual(await rows(), [{ inviter_user_id: A, invitee_user_id: B, source: 'code', status: 'pending' }]);
});

test('attach refuses when the programme is off', async () => {
  await user(B);
  assert.deepEqual(await attach(B, A), { attached: false });
  assert.deepEqual(await rows(), []);
});

test('attach refuses a player older than the window', async () => {
  await enable();
  await user(B, "now() - interval '25 hours'");
  assert.deepEqual(await attach(B, A), { attached: false });
  assert.deepEqual(await rows(), []);
});

test('attach refuses self, and bots on either side', async () => {
  await enable();
  await user(B);
  assert.deepEqual(await attach(B, B), { attached: false });
  await query('insert into bot_identities values ($1)', [A]);
  assert.deepEqual(await attach(B, A), { attached: false });
  await query('truncate bot_identities');
  await query('insert into bot_identities values ($1)', [B]);
  assert.deepEqual(await attach(B, A), { attached: false });
  assert.deepEqual(await rows(), []);
});

test('the first referral wins', async () => {
  await enable();
  await user(B);
  await user(C, "now() - interval '30 days'");
  assert.equal((await attach(B, A)).attached, true);
  assert.deepEqual(await attach(B, C, 'room'), { attached: false });
  assert.deepEqual(await rows(), [{ inviter_user_id: A, invitee_user_id: B, source: 'code', status: 'pending' }]);
});

test('attach refuses the reverse of an existing referral', async () => {
  await enable();
  await query('update auth.users set created_at = now() where id = $1', [A]);
  await user(B);
  assert.equal((await attach(B, A)).attached, true);
  assert.deepEqual(await attach(A, B), { attached: false });
  assert.equal((await rows()).length, 1);
});

test('settle waits for enough games', async () => {
  await enable();
  await user(B, "now() - interval '30 hours'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 1);
  assert.deepEqual(await settle(B), { paid: false });
  assert.equal((await rows())[0].status, 'pending');
});

test('settle waits for a later Nepal day', async () => {
  await enable();
  await user(B, "'2026-11-20 09:00+05:45'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 2);
  // Eleven hours later, still 20 Nov in Nepal.
  assert.deepEqual(await settle(B, '2026-11-20 20:00+05:45'), { paid: false });
});

test('settle pays both sides once', async () => {
  await enable();
  await user(B, "now() - interval '30 hours'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 2);
  const paid = await settle(B);
  const id = (await one('select id from referrals')).id;
  assert.deepEqual(paid, {
    paid: true, referralId: id, inviterUserId: A, inviteeUserId: B,
    inviterPaid: true, inviterCoins: 200, inviteeCoins: 100,
  });
  assert.deepEqual(await credits(), [
    { user_id: B, delta: 100, reason: 'referral-invitee', ext_id: `referral:${id}:invitee` },
    { user_id: A, delta: 200, reason: 'referral-inviter', ext_id: `referral:${id}:inviter` },
  ]);
  assert.equal((await rows())[0].status, 'rewarded');
  const balances = await query('select user_id, balance from wallets order by user_id');
  assert.deepEqual(await settle(B), { paid: false });
  assert.deepEqual(await query('select user_id, balance from wallets order by user_id'), balances);
  assert.equal((await credits()).length, 2);
});

test('a sign-up just before Nepal midnight waits 8 hours', async () => {
  await enable();
  await user(B, "'2026-11-19 23:55+05:45'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 2);
  // Ten minutes later it is already 20 Nov in Nepal, but only 10 minutes have passed.
  assert.deepEqual(await settle(B, '2026-11-20 00:05+05:45'), { paid: false });
  // 8 hours 5 minutes after sign-up, on a later Nepal day.
  assert.equal((await settle(B, '2026-11-20 08:00+05:45')).paid, true);
});

test('an inviter at the weekly cap is not paid, the invitee still is', async () => {
  await enable();
  for (let n = 100; n < 110; n++) {
    await user(uid(n), "now() - interval '3 days'");
    await query("insert into referrals(inviter_user_id, invitee_user_id, source, status, qualified_at) values ($1, $2, 'code', 'rewarded', now() - interval '1 day')", [A, uid(n)]);
  }
  await user(B, "now() - interval '30 hours'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 2);
  const paid = await settle(B);
  assert.equal(paid.paid, true);
  assert.equal(paid.inviterPaid, false);
  assert.deepEqual((await credits()).map(c => [c.user_id, c.delta]), [[B, 100]]);
  assert.equal((await one('select status from referrals where invitee_user_id = $1', [B])).status, 'inviter_capped');
});

test('the lifetime cap applies the same way', async () => {
  await enable();
  for (let n = 100; n < 125; n++) {
    await user(uid(n), "now() - interval '60 days'");
    await query("insert into referrals(inviter_user_id, invitee_user_id, source, status, qualified_at) values ($1, $2, 'code', 'rewarded', now() - interval '30 days')", [A, uid(n)]);
  }
  await user(B, "now() - interval '30 hours'");
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [A, B]);
  await games(B, 2);
  const paid = await settle(B);
  assert.equal(paid.inviterPaid, false);
  assert.deepEqual((await credits()).map(c => [c.user_id, c.delta]), [[B, 100]]);
});

test('deleting the invitee removes the referral', async () => {
  await enable();
  await user(B);
  await attach(B, A);
  await query('delete from auth.users where id = $1', [B]);
  assert.deepEqual(await rows(), []);
});

test('list shows invited friends with their state', async () => {
  await enable();
  const D = uid(4);
  await user(B, "'2026-11-20 09:00+05:45'"); // today, 1 game
  await user(C, "'2026-11-20 08:00+05:45'"); // today, 3 games: enough, but no return day yet
  await user(D, "'2026-11-18 09:00+05:45'"); // rewarded
  await query("insert into referrals(inviter_user_id, invitee_user_id, source, created_at) values ($1, $2, 'code', '2026-11-20 09:01+05:45'), ($1, $3, 'room', '2026-11-20 08:01+05:45')", [A, B, C]);
  await query("insert into referrals(inviter_user_id, invitee_user_id, source, status, qualified_at, created_at) values ($1, $2, 'code', 'rewarded', '2026-11-19 10:00+05:45', '2026-11-18 09:01+05:45')", [A, D]);
  await games(B, 1);
  await games(C, 3);
  await games(D, 2);
  await query("insert into profiles values ($1, 'Asha', 'cap')", [C]);

  const mine = await list(A);
  assert.deepEqual(mine.config, { enabled: true, inviterCoins: 200, inviteeCoins: 100, gamesRequired: 2 });
  assert.deepEqual(mine.invited.map(f => [f.name, f.gamesPlayed, f.state]), [
    [null, 1, 'playing'],
    ['Asha', 2, 'nextDay'],
    [null, 2, 'rewarded'],
  ]);
  assert.equal(mine.invitedBy, null);

  const theirs = await list(D);
  assert.deepEqual(theirs.invited, []);
  assert.equal(theirs.invitedBy.id !== undefined, true);
  assert.equal(theirs.invitedBy.state, 'rewarded');
});

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { economySchema } from './helpers/economySchema.mjs';

// 0084: where an Android install came from (and a friend link becoming a
// referral), and the device rule that stops one phone farming referral coins.
let db;
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const one = async (text, args = []) => (await query(text, args))[0];
const hash = (c) => c.repeat(64);

const A = uid(1); // inviter
const B = uid(2); // invitee
const C = uid(3); // a second invitee

const user = (id, createdAt = 'now()') => query(`insert into auth.users(id, created_at) values ($1, ${createdAt})`, [id]);
const install = (id, args) =>
  one('select install_source_record($1, $2, $3, $4, $5, $6, $7) r',
    [id, 'android', args.referrer ?? null, args.source ?? null, args.medium ?? null, args.campaign ?? null, args.friend ?? null]).then((x) => x.r);
const device = (id, h) => one('select device_record($1, $2) r', [id, h]).then((x) => x.r);
const settle = (id) => one('select referral_settle($1) r', [id]).then((x) => x.r);
const qualifiable = async (inviter, invitee) => {
  await query("insert into referrals(inviter_user_id, invitee_user_id, source) values ($1, $2, 'code')", [inviter, invitee]);
  await query('insert into player_stats(user_id, games_played) values ($1, 2) on conflict (user_id) do update set games_played = 2', [invitee]);
};

before(async () => {
  db = await PGlite.create();
  await db.exec(await economySchema());
  await db.exec(`
    alter table auth.users add column created_at timestamptz not null default now();
    create table bot_identities(user_id uuid primary key, visible boolean not null default false);
    create table app_config(key text primary key, value jsonb not null);
    create table profiles(user_id uuid primary key, display_name text, avatar_id text);
    create table friend_codes(user_id uuid primary key, code text unique);
  `);
  await db.exec(await migration('0082_referrals.sql'));
  await db.exec(await migration('0084_install_and_device.sql'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate user_devices, install_sources, friend_codes, referrals, wallets, wallet_txns, player_stats, bot_identities, app_config, profiles, auth.users cascade;');
  await query("insert into app_config values ('default', '{\"economy\":{\"referral\":{\"enabled\":true}}}')");
  await user(A, "now() - interval '30 days'");
});

test('an install source is recorded once, with its utm fields', async () => {
  await user(B);
  const r = await install(B, { referrer: 'utm_source=website&utm_medium=landing', source: 'website', medium: 'landing' });
  assert.equal(r.recorded, true);
  assert.equal((await install(B, { referrer: 'utm_source=other', source: 'other' })).recorded, false);
  const row = await one('select platform, utm_source, utm_medium, utm_campaign, friend_code from install_sources where user_id = $1', [B]);
  assert.deepEqual(row, { platform: 'android', utm_source: 'website', utm_medium: 'landing', utm_campaign: null, friend_code: null });
});

test('a friend code in the referrer records a link referral', async () => {
  await user(B);
  await query("insert into friend_codes values ($1, 'K7PXQ2')", [A]);
  const r = await install(B, { referrer: 'utm_source=invite&friend=K7PXQ2', source: 'invite', friend: 'K7PXQ2' });
  assert.equal(r.referral.attached, true);
  assert.deepEqual(await query('select inviter_user_id, invitee_user_id, source from referrals'), [{ inviter_user_id: A, invitee_user_id: B, source: 'link' }]);
});

test('an unknown friend code records no referral', async () => {
  await user(B);
  const r = await install(B, { referrer: 'friend=ZZZZZZ', friend: 'ZZZZZZ' });
  assert.equal(r.recorded, true);
  assert.equal(r.referral.attached, false);
  assert.deepEqual(await query('select * from referrals'), []);
});

test('a referral on the inviter\'s own device is rejected, nothing paid', async () => {
  await user(B, "now() - interval '30 hours'");
  await qualifiable(A, B);
  await device(A, hash('a'));
  await device(B, hash('a'));
  const r = await settle(B);
  assert.equal(r.paid, false);
  assert.equal(r.rejected, true);
  assert.equal((await one('select status from referrals where invitee_user_id = $1', [B])).status, 'rejected');
  assert.deepEqual(await query("select * from wallet_txns where reason like 'referral-%'"), []);
});

test('a second referral payout on one device is rejected', async () => {
  await user(B, "now() - interval '30 hours'");
  await user(C, "now() - interval '30 hours'");
  await qualifiable(A, B);
  await qualifiable(A, C);
  await device(B, hash('b'));
  await device(C, hash('b')); // the same phone, a fresh guest account
  assert.equal((await settle(B)).paid, true);
  const second = await settle(C);
  assert.equal(second.paid, false);
  assert.equal(second.rejected, true);
});

test('different devices pay normally', async () => {
  await user(B, "now() - interval '30 hours'");
  await qualifiable(A, B);
  await device(A, hash('a'));
  await device(B, hash('b'));
  assert.equal((await settle(B)).paid, true);
});

test('device_record ignores bots and bad hashes', async () => {
  await user(B);
  await query('insert into bot_identities(user_id) values ($1)', [B]);
  assert.equal(await device(B, hash('c')), false);
  await user(C);
  assert.equal(await device(C, 'short'), false);
  assert.equal(await device(C, hash('d')), true);
  assert.equal(await device(C, hash('d')), false);
});

test('a rejected referral is left off both invite cards', async () => {
  await user(B, "now() - interval '30 hours'");
  await qualifiable(A, B);
  await device(A, hash('a'));
  await device(B, hash('a'));
  await settle(B);
  const mine = (await one('select referral_list($1) r', [A])).r;
  const theirs = (await one('select referral_list($1) r', [B])).r;
  assert.deepEqual(mine.invited, []);
  assert.equal(theirs.invitedBy, null);
});

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { economySchema } from './helpers/economySchema.mjs';

// Reward spin (0086): what a player is owed (daily, first game, match spins),
// and the claim that checks, picks, pays and logs in one transaction. Times are
// passed explicitly as p_now so nothing depends on the hour the suite runs at.
let db;
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const one = async (text, args = []) => (await query(text, args))[0];

const A = uid(1);
const B = uid(2);
const C = uid(3);
const D = uid(4);
const BOT = uid(99);
const NOW = '2026-11-22T12:00:00Z';
const TODAY = '2026-11-22';

const user = (id) => query('insert into auth.users(id) values ($1) on conflict do nothing', [id]);
// The spin block as the migration ships it, with test overrides merged on top.
const setSpin = (over = {}, gemsOn = true) =>
  query(
    `insert into app_config(key, value)
     values ('default', jsonb_build_object('spin', spin_default_config() || $1::jsonb, 'gems', $2::jsonb))
     on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(over), JSON.stringify({ enabled: gemsOn, exchangeRate: 10 })],
  );
const enable = (over = {}, gemsOn = true) => setSpin({ enabled: true, ...over }, gemsOn);
const played = (id, n) =>
  query(
    `insert into player_stats(user_id, games_played) values ($1, $2)
     on conflict (user_id) do update set games_played = excluded.games_played`,
    [id, n],
  );
const bonus = (id, lastOn, streak) =>
  query(
    `insert into wallets(user_id, last_bonus_on, streak_day) values ($1, $2::date, $3)
     on conflict (user_id) do update set last_bonus_on = excluded.last_bonus_on, streak_day = excluded.streak_day`,
    [id, lastOn, streak],
  );
let room = 0;
// A finished online game with the player in it (and a bot opponent).
const finishGame = (id, { hasLeft = false, day = TODAY } = {}) =>
  query(
    `insert into games(room_code, host_user_id, status, state, updated_at)
     values ($1, $2, 'finished', $3::jsonb, $4::timestamptz)`,
    [
      `R${++room}`,
      id,
      JSON.stringify({
        status: 'finished',
        players: [
          { id: 'p1', userId: id, color: 'red', isConnected: true, hasLeft },
          { id: 'p2', userId: BOT, color: 'yellow', isConnected: true },
        ],
      }),
      `${day}T10:00:00Z`,
    ],
  );
const status = async (id, now = NOW) => (await one('select spin_status($1, $2::timestamptz) s', [id, now])).s;

before(async () => {
  db = await PGlite.create();
  await db.exec(await economySchema());
  await db.exec('alter table wallets add column if not exists gems int not null default 0;');
  const gems = await migration('0018_gems.sql');
  await db.exec(gems.slice(gems.indexOf('create table if not exists public.gem_txns'), gems.indexOf('-- 3.')));
  await db.exec('create table app_config(key text primary key, value jsonb not null);');
  await db.exec(await migration('0086_reward_spin.sql'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate spin_log, games, wallets, wallet_txns, gem_txns, player_stats, app_config, auth.users cascade;');
  for (const id of [A, B, C, D]) await user(id);
});

test('the migration seeds the spin block once and never overwrites it', async () => {
  await query(`insert into app_config(key, value) values ('default', '{"gems": {"enabled": true}}')`);
  await db.exec(await migration('0086_reward_spin.sql'));
  const seeded = (await one(`select value->'spin' s from app_config where key = 'default'`)).s;
  assert.equal(seeded.enabled, false);
  assert.equal(seeded.tableVersion, 1);
  await query(`update app_config set value = jsonb_set(value, '{spin,enabled}', 'true') where key = 'default'`);
  await db.exec(await migration('0086_reward_spin.sql'));
  assert.equal((await one(`select value->'spin'->'enabled' e from app_config where key = 'default'`)).e, true);
});

test('status is disabled by default and for users off the allowlist', async () => {
  assert.deepEqual(await status(A), { enabled: false });
  await setSpin();
  assert.deepEqual(await status(A), { enabled: false });
  await setSpin({ allowlistUserIds: [A] });
  assert.equal((await status(A)).enabled, true);
  assert.deepEqual(await status(B), { enabled: false });
});

test('a new player owes daily, first is locked, no match spins', async () => {
  await enable();
  const s = await status(A);
  assert.deepEqual(s.owed, { first: 'locked', daily: true, match: 0 });
  assert.equal(s.matchMax, 3);
  assert.equal(s.tableVersion, 1);
  assert.equal(s.tier, 'bronze');
  assert.equal(s.next.source, 'daily');
  assert.equal(s.next.wheel, 'bronze');
  assert.deepEqual(s.next.segments[0], { coins: 25, w: 280 });
  assert.equal(s.next.segments.length, 9);
});

test('first-game spin is owed after one played game and comes first', async () => {
  await enable();
  await played(A, 1);
  const s = await status(A);
  assert.equal(s.owed.first, 'owed');
  assert.equal(s.next.source, 'first');
  assert.equal(s.next.wheel, 'firstGame');
  assert.deepEqual(s.next.segments.map((g) => g.w), [400, 300, 200, 80, 20]);
});

test('tier follows the streak as it stands today', async () => {
  await enable();
  await bonus(A, TODAY, 3);
  await bonus(B, '2026-11-21', 6);
  await bonus(C, '2026-11-19', 7);
  assert.equal((await status(A)).tier, 'silver');
  assert.equal((await status(B)).tier, 'gold');
  assert.equal((await status(C)).tier, 'bronze');
  assert.equal((await status(B)).next.wheel, 'gold');
});

test('match spins count finished games still seated, capped at 3', async () => {
  await enable();
  await finishGame(A);
  await finishGame(A);
  await finishGame(B);
  await finishGame(B, { hasLeft: true });
  for (let i = 0; i < 5; i++) await finishGame(C);
  await finishGame(D, { day: '2026-11-21' });
  assert.equal((await status(A)).owed.match, 2);
  assert.equal((await status(B)).owed.match, 1);
  assert.equal((await status(C)).owed.match, 3);
  assert.equal((await status(D)).owed.match, 0);
});

test('gem segments become coins when gems are off', async () => {
  await enable({}, false);
  const segments = (await status(A)).next.segments;
  assert.ok(segments.every((g) => !('gems' in g)));
  assert.deepEqual(segments[5], { coins: 20, w: 50 });
  await enable({}, true);
  assert.deepEqual((await status(A)).next.segments[5], { gems: 2, w: 50 });
});

test('resetsAt is the next 00:00 UTC', async () => {
  await enable();
  assert.equal((await status(A, '2026-11-22T23:30:00Z')).resetsAt, '2026-11-23T00:00:00Z');
  assert.equal((await status(A, '2026-11-23T00:00:00Z')).resetsAt, '2026-11-24T00:00:00Z');
});

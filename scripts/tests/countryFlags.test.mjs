import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { economySchema } from './helpers/economySchema.mjs';

// Country flags (0083): a player's country comes from the request header, set
// once, never for a bot, never after they hid it; hidden bots get a country
// that suits their name.
let db;
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = async (text, args = []) => (await db.query(text, args)).rows;
const one = async (text, args = []) => (await query(text, args))[0];

const A = uid(1);
const BOT = uid(2);

const person = async (id, name = 'Asha') => {
  await query('insert into auth.users(id) values ($1)', [id]);
  await query('insert into profiles(user_id, display_name, avatar_id) values ($1, $2, $3)', [id, name, 'cap']);
};
const setCountry = async (id, code) => (await one('select profile_set_country($1, $2) r', [id, code])).r;
const countryOf = async (id) => (await one('select country from profiles where user_id = $1', [id])).country;
const botCountry = async (id, name) => (await one('select bot_country_for($1, $2) r', [id, name])).r;

before(async () => {
  db = await PGlite.create();
  await db.exec(await economySchema());
  await db.exec(`
    create table bot_identities(user_id uuid primary key, visible boolean not null default false);
    create table profiles(user_id uuid primary key, display_name text, avatar_id text);
  `);
  await db.exec(await migration('0083_country_flags.sql'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate profiles, bot_identities, auth.users cascade;');
});

test('set_country stores a valid code once', async () => {
  await person(A);
  assert.equal(await setCountry(A, 'np'), true);
  assert.equal(await countryOf(A), 'NP');
  assert.equal(await setCountry(A, 'IN'), false);
  assert.equal(await countryOf(A), 'NP');
});

test('set_country ignores unknown and malformed codes', async () => {
  await person(A);
  for (const code of ['XX', 'T1', '', null, 'USA', '1A', 'n']) {
    assert.equal(await setCountry(A, code), false, String(code));
  }
  assert.equal(await countryOf(A), null);
});

test('a hidden flag is never set again', async () => {
  await person(A);
  await query('update profiles set country_hidden = true where user_id = $1', [A]);
  assert.equal(await setCountry(A, 'NP'), false);
  assert.equal(await countryOf(A), null);
});

test('set_country never touches a bot', async () => {
  await person(BOT, 'Priya');
  await query('insert into bot_identities(user_id) values ($1)', [BOT]);
  assert.equal(await setCountry(BOT, 'US'), false);
  assert.equal(await countryOf(BOT), null);
});

test('named bots get a country that suits the name', async () => {
  const cases = [
    ['Arjun K', 'IN'], ['Rahul99', 'IN'], ['Ipsita', 'IN'], ['Maya', 'NP'], ['Tara78', 'NP'],
    ['Anika24', 'BD'], ['Aisha', 'PK'], ['Omar87', 'AE'], ['Clara14', 'BR'], ['Lucas P45', 'BR'],
    ['Elena V28', 'ES'], ['Mateo62', 'ES'], ['Jonas75', 'DE'], ['Isla', 'GB'], ['Noah S', 'US'],
    ['Tomas97', 'PT'], ['Kenji', 'JP'], ['Marco B', 'IT'],
  ];
  for (const [name, code] of cases) assert.equal(await botCountry(BOT, name), code, name);
});

test('guest-handle bots are stable and spread like players', async () => {
  assert.equal(await botCountry(BOT, 'guest117470'), await botCountry(BOT, 'guest117470'));
  const rows = await query(
    `select bot_country_for(('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'guest' || i) c, count(*)::int n
       from generate_series(1, 2000) i group by 1 order by 2 desc`);
  const counts = Object.fromEntries(rows.map((r) => [r.c ?? 'none', r.n]));
  assert.equal(rows[0].c, 'IN');
  assert.ok(counts.none >= 100 && counts.none <= 300, `none: ${counts.none}`);
  for (const code of Object.keys(counts)) assert.ok(['IN', 'NP', 'BD', 'PK', 'AE', 'US', 'none'].includes(code), code);
});

test('bot_assign_country fills only an empty country', async () => {
  await person(BOT, 'Priya');
  assert.equal((await one('select bot_assign_country($1) r', [BOT])).r, 'IN');
  assert.equal(await countryOf(BOT), 'IN');
  await query("update profiles set country = 'GB' where user_id = $1", [BOT]);
  assert.equal((await one('select bot_assign_country($1) r', [BOT])).r, 'GB');
  assert.equal(await countryOf(BOT), 'GB');
});

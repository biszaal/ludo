import { readFile } from 'node:fs/promises';
const sql = name => readFile(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8');
// Focused platform fixture; intentionally not a full Supabase installation.
export async function economySchema() {
  const parts = [];
  parts.push(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`);
  parts.push((await sql('0001_init.sql')).replace(/^alter publication .*;$/gm, ''));
  parts.push(`alter table games add state_version int not null default 0,
    add is_quick boolean not null default false, add fold_writes boolean not null default false,
    add turn_deadline timestamptz, add quick_size int not null default 2,
    add mode text not null default 'classic';
    alter table players add app_version text, add is_bot boolean not null default false;
    create table game_bots(game_id uuid, user_id uuid, can_chat boolean not null default true, primary key(game_id,user_id));
    create table rate_limits(window_start timestamptz);`);
  for (const name of ['0010_coins.sql', '0013_economy.sql', '0016_player_stats.sql', '0076_atomic_game_economy.sql', '0077_atomic_quick_match.sql']) {
    parts.push(await sql(name));
  }
  return parts.join('\n');
}

-- Registered display names are unique (case-insensitive): they identify a
-- player across rooms, so two accounts can never present the same name.
--
-- Cleanup first, in two passes, so the index can be created on live data:
--  1. Placeholder identities — "You" (the old client default, which made every
--     seat read "You" on everyone's screen) and "Player" (the column default) —
--     become per-user guest handles, matching the client's new guestNNNNNN
--     fallback.
--  2. Case-insensitive duplicates among real names: the most recent editor
--     keeps the name, everyone else gets a guest handle.
-- Handles derive from the user_id hash: deterministic and rerunnable.

update public.profiles
set display_name = 'guest' || lpad((abs(hashtext(user_id::text)) % 1000000)::text, 6, '0')
where lower(display_name) in ('you', 'player');

update public.profiles p
set display_name = 'guest' || lpad((abs(hashtext(p.user_id::text)) % 1000000)::text, 6, '0')
where exists (
  select 1
  from public.profiles q
  where lower(q.display_name) = lower(p.display_name)
    and q.user_id <> p.user_id
    and (q.updated_at > p.updated_at
         or (q.updated_at = p.updated_at and q.user_id > p.user_id))
);

create unique index if not exists profiles_display_name_ci_unique
  on public.profiles (lower(display_name));

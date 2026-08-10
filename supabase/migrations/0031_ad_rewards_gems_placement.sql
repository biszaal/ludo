-- Let the 'gems' rewarded placement through ad_rewards' placement CHECK.
--
-- 0027 added the `currency` column and the server-side 'gems' placement but
-- missed this: 0013 pinned `placement` to an enumerated list, so every gem
-- reward intent failed at insert with a constraint violation. Caught by an
-- end-to-end call against the deployed function, not by any test — the client
-- suite doesn't touch Postgres and the Deno tests stub the client.
--
-- The list stays enumerated rather than being dropped. It is the schema-level
-- half of the fairness guard: adding an advantage-shaped placement should
-- require a migration someone has to write and justify, not just a string in
-- application code.

alter table public.ad_rewards drop constraint if exists ad_rewards_placement_check;

alter table public.ad_rewards
  add constraint ad_rewards_placement_check
  check (placement in ('coins', 'free-entry', 'double-pot', 'gems'));

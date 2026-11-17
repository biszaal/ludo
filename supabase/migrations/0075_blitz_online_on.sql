-- Open online Blitz.
--
-- Apply only once the function that understands games.mode (after 0074) is
-- deployed and smoke-tested. Against the old function a client would ask for
-- Blitz and be dealt classic without a word.
--
-- Takes effect on every installed build at once, but only builds that carry the
-- mode picker read it; older ones ignore the key and keep playing classic.
update public.app_config
   set value = jsonb_set(value, '{modes,blitzOnline}', 'true'::jsonb, true),
       updated_at = now()
 where key = 'default';

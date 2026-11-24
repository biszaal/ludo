-- 0088: app_config is read by the server only.
--
-- The reward spin keeps its test-account allowlist (user ids) in
-- app_config.default (0086). 0012's "config: read" policy let any signed-in
-- client SELECT that row straight from the database. No app version has ever
-- read app_config directly (they all use the game function's config op, which
-- leaves the spin block out), and every database function that reads it runs
-- as its owner (security definer). So clients simply lose the privilege; the
-- policy stays, inert.
revoke select on public.app_config from anon, authenticated;

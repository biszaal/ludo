-- Onyx II: the v2 drawing of Onyx, sold beside the original instead of
-- replacing it.
--
-- 0070 redrew all twenty-one existing faces in place, on the reasoning that an
-- id is what a profile stores and the art behind it is free to improve. That
-- reasoning holds for twenty of them. It does not hold for Onyx, because at
-- least one player asked for that specific face — he is the one character in
-- the catalog players identify by a single detail, the red cap, which is why
-- his cap already carries the only colour override in the art and why it had
-- to be restored once before after a refactor flattened him into charcoal.
--
-- A redraw is not an upgrade to someone who liked what you replaced. So the
-- original art is kept verbatim under 'onyx' — the v1 op list, unchanged, in
-- the 100-unit space it was drawn in — and the v2 drawing ships as its own
-- avatar here. Nobody loses a face they bought, and anyone who prefers the new
-- one can have it.
--
-- Priced at 100 gems, the same as Onyx (0018). It is the same character at the
-- same tier, drawn differently; charging more for the redraw would be charging
-- for the art team's opinion.
--
-- No entitlement migration. 'onyx' is untouched — same sku, same price, same
-- rows — so every player who owns him still owns him and still sees exactly
-- the face they bought. Buying Onyx does not grant Onyx II, and vice versa;
-- they are two catalog entries, and 0059's enforce_avatar_ownership trigger
-- covers the new one the moment this lands, since it reads the catalog by sku.

insert into public.catalog (sku, kind, price, currency, active) values
  ('avatar.onyx-ii', 'avatar', 100, 'gems', true)
on conflict (sku) do nothing;

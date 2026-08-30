/**
 * RevenueCat webhook → gems credit (Supabase Edge / Deno).
 *
 * RevenueCat is the source of truth that a real-money gem pack was actually
 * paid for (it validates the App Store / Play receipt). It then calls this
 * endpoint, and THIS is the only path that mints paid gems in production — the
 * client never credits itself.
 *
 * Security + correctness:
 *  - Auth: the request's `Authorization` header must equal RC_WEBHOOK_AUTH (set
 *    in the RC dashboard AND `supabase secrets set`). No match → 401, no credit.
 *  - Idempotency: gems are credited via gem_apply keyed on `rc:<transaction_id>`.
 *    RC retries a webhook until it gets a 2xx, so the same purchase can arrive
 *    several times; the gem_txns unique index means it still credits exactly
 *    once. A crediting failure returns 500 so RC retries later.
 *  - app_user_id IS the Supabase user id — the client calls Purchases.logIn(uid)
 *    so every purchase attaches to the right account (and survives account
 *    linking, since the id is stable).
 *  - SANDBOX events never credit. RevenueCat reports the store environment, and
 *    a sandbox purchase is one nobody paid for: TestFlight and Play licence
 *    testers get them for free, and a jailbroken device can force StoreKit into
 *    that environment at will. Crediting them tagged `iap-sandbox` — which is
 *    what this did until 0055 — still put real spendable gems in a real wallet,
 *    and gems exchange one-way into coins that are staked against other
 *    players. Set `gems.creditSandboxPurchases` in server config to re-enable
 *    it on a staging project; it is never seeded true.
 *
 * FAIRNESS (0018 invariant): gems buy access and appearance only. This function
 * moves currency; it can never touch a match outcome.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { secretMatches } from "../_shared/secret.ts";

type Json = Record<string, unknown>;

/** Fallback product→gems map; server config (gems.products) wins when present.
 *  Mirrors the migration seed and the game function's GEM_PRODUCTS. */
const GEM_PRODUCTS: Record<string, number> = {
  "gems.small": 60,
  "gems.medium": 340,
  "gems.large": 750,
};

/** RC event types that represent a completed one-off (consumable) purchase. */
const PURCHASE_TYPES = new Set(["NON_RENEWING_PURCHASE", "INITIAL_PURCHASE"]);

const STORE_PROVIDER: Record<string, string> = {
  APP_STORE: "appstore",
  MAC_APP_STORE: "appstore",
  PLAY_STORE: "play",
};

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** The `gems` block of the default app_config row. One read serves both the
 *  product map and the sandbox gate below. */
async function gemsConfig(admin: SupabaseClient): Promise<Json> {
  const { data } = await admin.from("app_config").select("value").eq("key", "default").maybeSingle();
  return (((data as { value?: Json } | null)?.value)?.gems ?? {}) as Json;
}

/** gems.products → { productId: gems }, over the built-in fallbacks. */
export function productGems(gems: Json): Record<string, number> {
  const products = Array.isArray(gems.products) ? (gems.products as { id?: string; gems?: number }[]) : [];
  const map: Record<string, number> = { ...GEM_PRODUCTS };
  for (const p of products) if (p.id && typeof p.gems === "number") map[p.id] = p.gems;
  return map;
}

/**
 * May this event move real currency?
 *
 * SANDBOX is the environment for purchases nobody paid for, and it is reachable
 * by more people than it sounds: TestFlight testers, Play licence testers, and
 * any device that can force StoreKit's sandbox. The flag is the staging escape
 * hatch and is never seeded true — so production refuses by construction rather
 * than by remembering to check.
 */
export function creditable(environment: string, gems: Json): boolean {
  if (environment.toUpperCase() !== "SANDBOX") return true;
  return gems.creditSandboxPurchases === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  // 1) Authenticate the caller as RevenueCat (shared secret).
  //
  // Constant-time: a plain `!==` short-circuits on the first differing byte, and
  // this header is the only thing between an anonymous caller and minting paid
  // gems for an arbitrary user id. Fails closed on an unset secret — an empty
  // `expected` would otherwise match an empty header.
  const expected = Deno.env.get("RC_WEBHOOK_AUTH") ?? "";
  if (!expected) return json({ error: "Webhook not configured." }, 500);
  if (!secretMatches(req.headers.get("Authorization") ?? "", expected)) {
    return json({ error: "Unauthorized." }, 401);
  }

  // 2) Parse the event.
  let body: Json;
  try {
    body = (await req.json()) as Json;
  } catch {
    return json({ error: "Bad payload." }, 400);
  }
  const event = (body.event ?? {}) as Json;
  const type = String(event.type ?? "");
  const appUserId = String(event.app_user_id ?? "");
  const productId = String(event.product_id ?? "");
  // One credit per store transaction; fall back to the event id if absent.
  const txnId = String(event.transaction_id ?? event.id ?? "");
  const store = String(event.store ?? "");
  const environment = String(event.environment ?? "");

  // 3) Ignore anything that isn't a completed purchase (ack so RC stops retrying).
  if (!PURCHASE_TYPES.has(type)) return json({ ok: true, ignored: type });

  if (!appUserId || !txnId) return json({ error: "Missing app_user_id or transaction id." }, 400);
  // Anonymous RC ids (never logged in) can't map to a Supabase user — drop it
  // rather than credit a ghost. Fix is client-side (Purchases.logIn).
  if (appUserId.startsWith("$RCAnonymousID:")) return json({ ok: true, ignored: "anonymous app_user_id" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 4) Resolve the gem amount for the purchased product.
  const gemsCfg = await gemsConfig(admin);
  const gems = productGems(gemsCfg)[productId];
  if (!gems || gems <= 0) return json({ error: `Unknown product ${productId}.` }, 400);

  const provider = STORE_PROVIDER[store] ?? "stub";

  // 5) Sandbox stops here. Recorded, so a tester can still see their purchase
  //    arrived and the wiring is provably working, but never credited. 200 so
  //    RC treats it as delivered and stops retrying — this is a settled
  //    outcome, not a transient failure.
  if (!creditable(environment, gemsCfg)) {
    console.log("rc: sandbox purchase not credited", { appUserId, productId, txnId });
    await admin
      .from("iap_purchases")
      .insert({ user_id: appUserId, product_id: productId, gems, provider, provider_txn_id: txnId, status: "sandbox" })
      .then(undefined, () => {});
    return json({ ok: true, ignored: "sandbox environment" });
  }

  // 6) Audit row (best-effort; the credit's own ledger is the real guard).
  await admin
    .from("iap_purchases")
    .insert({ user_id: appUserId, product_id: productId, gems, provider, provider_txn_id: txnId, status: "credited", credited_at: new Date().toISOString() })
    .then(undefined, () => {}); // unique (provider, provider_txn_id) → duplicate webhook, fine

  // 7) Credit — idempotent on rc:<txnId>. A DB failure returns 500 so RC retries.
  const { data, error } = await admin.rpc("gem_apply", {
    p_user: appUserId,
    p_delta: gems,
    p_reason: "iap",
    p_ext_id: `rc:${txnId}`,
  });
  if (error || data == null) return json({ error: "Credit failed." }, 500);

  return json({ ok: true, userId: appUserId, gems, balance: data });
});

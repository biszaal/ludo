/**
 * Coins, gems, rewarded ads, the shop, and the region-resolved remote config.
 *
 * All balances live in `wallets`, mutated ONLY through the wallet_apply /
 * gem_apply RPCs (atomic, overdraw-guarded, ledgered). Sources: winning a pot,
 * the daily bonus, rewarded ads (SSV-verified only), and a once-a-day pity
 * grant at zero. 0010's unlimited floor top-up is gone — it made coins
 * impossible to run out of, so nothing was worth earning.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import {
  deepMerge,
  json,
  LIMITS,
  QUICK_STAKE,
  rateLimited,
  rateOk,
  serverConfig,
  utcDay,
  type Json,
  type SupabaseClient,
} from "./lib.ts";
import { gemApply, pityReady, readWallet, walletApply } from "./wallet.ts";

/** Gem products. Fallback only — gems.products in server config wins. Kept
 *  minimal on purpose: three places carry these (migration seed, this const,
 *  client DEFAULT_CONFIG) and the config read is preferred everywhere. */
const GEM_PRODUCTS: Record<string, number> = {
  "gems.small": 60,
  "gems.medium": 340,
  "gems.large": 750,
};

/** Daily bonus: base plus a step per consecutive day, capped. */
const DAILY_BONUS_BASE = 50;
const DAILY_STREAK_STEP = 25;
const DAILY_STREAK_MAX = 7;

/** Streak finale also pays gems. Fallbacks; economy.gemDay/gemAmount win. */
const DAILY_GEM_DAY = 7;
const DAILY_GEM_AMOUNT = 5;

/** Amounts per rewarded ad, by placement. Server-owned — the client never says
 *  how much a view is worth, it only says which placement it wants.
 *
 *  The `gems` placement is denominated in GEMS, not coins; ad_rewards.currency
 *  (0027) carries which, and functions/ads-ssv branches the credit on it. */
const REWARD_COINS: Record<string, number> = {
  coins: 100,
  "free-entry": QUICK_STAKE,
  "double-pot": 0, // computed from the game's stake at intent time
  gems: 1, // overridden by gems.adGrant.amount
};
/** Rewarded grants a single account can bank per UTC day, by placement. */
const REWARD_DAILY_CAP: Record<string, number> = {
  coins: 8,
  "free-entry": 5,
  "double-pot": 3,
  gems: 1, // overridden by gems.adGrant.dailyCap
};

/** Which currency a placement pays in. Anything unlisted is coins. */
const REWARD_CURRENCY: Record<string, "coins" | "gems"> = {
  gems: "gems",
};

/** A positive number from a config value, or the fallback. Config is operator
 *  input, not player input, but a typo shouldn't mint or zero out a grant. */
function positiveNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Ad pacing + economy display config, resolved for the caller's region.
 *
 *  Region comes from the edge network's geo header when present, falling back
 *  to whatever the client claims. That fallback is spoofable — fine here,
 *  since everything this returns is pacing and presentation. Never gate coin
 *  PURCHASES on it; use the store receipt's billing country for that. */
export async function opConfig(admin: SupabaseClient, req: Request, claimed: string | null): Promise<Response> {
  const geo = req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country");
  const region = (geo && geo !== "XX" ? geo : claimed ?? "").trim().toUpperCase().slice(0, 2);

  const keys = region ? ["default", region] : ["default"];
  const { data } = await admin.from("app_config").select("key, value").in("key", keys);

  const rows = data ?? [];
  const base = (rows.find((r) => r.key === "default")?.value ?? {}) as Json;
  const local = region ? ((rows.find((r) => r.key === region)?.value ?? {}) as Json) : {};
  return json({ config: deepMerge(base, local), region: region || null });
}

export async function opWalletGet(admin: SupabaseClient, userId: string): Promise<Response> {
  const w = await readWallet(admin, userId);
  return json({ balance: w.balance });
}

/** Everything the wallet UI needs in one round trip. */
export async function opWalletState(admin: SupabaseClient, userId: string): Promise<Response> {
  const w = await readWallet(admin, userId);
  return json({
    balance: w.balance,
    purchasedBalance: w.purchased_balance,
    gems: w.gems,
    streakDay: w.streak_day,
    bonusClaimable: w.last_bonus_on !== utcDay(),
    pityAvailable: pityReady(w),
  });
}

// --- Gems --------------------------------------------------------------------
//
// Purchases are double-locked: gems.purchasesEnabled is the public flag, and
// while the provider is the stub, gems.allowStubProvider (server-only, never
// seeded true) must ALSO be set — a mistakenly flipped public flag cannot
// mint unpaid gems. A real store receipt later swaps the stub branch for
// verification and credits through the exact same table + rpc.
export async function opGemsBuy(admin: SupabaseClient, userId: string, productId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "gemsBuy", LIMITS.gemsBuy))) return rateLimited();
  const cfg = await serverConfig(admin);
  const gems = (cfg.gems ?? {}) as Json;
  if (gems.enabled !== true || gems.purchasesEnabled !== true) {
    return json({ error: "Purchases aren't available yet." });
  }
  if (gems.allowStubProvider !== true) {
    return json({ error: "Purchases aren't available yet." });
  }

  const products = Array.isArray(gems.products) ? (gems.products as { id?: string; gems?: number }[]) : [];
  const fromCfg = products.find((p) => p.id === productId)?.gems;
  const amount = typeof fromCfg === "number" && fromCfg > 0 ? fromCfg : GEM_PRODUCTS[productId];
  if (!amount) return json({ error: "Unknown product." });

  const { data: purchase, error } = await admin
    .from("iap_purchases")
    .insert({ user_id: userId, product_id: productId, gems: amount, provider: "stub" })
    .select("id")
    .single();
  if (error || !purchase) return json({ error: "Could not start the purchase." });

  const newGems = await gemApply(admin, userId, amount, "iap-stub", `iap:${purchase.id}`);
  if (newGems === null) return json({ error: "Could not complete the purchase." });

  await admin
    .from("iap_purchases")
    .update({ status: "credited", credited_at: new Date().toISOString() })
    .eq("id", purchase.id);
  return json({ gems: newGems, purchaseId: purchase.id });
}

/** One-way gems→coins at the server's rate. `key` makes a client retry a
 *  no-op — without one, each call is its own exchange. */
export async function opGemsExchange(
  admin: SupabaseClient,
  userId: string,
  gemsWanted: number,
  key: string | null,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "gemsExchange", LIMITS.gemsExchange))) return rateLimited();
  const cfg = await serverConfig(admin);
  const gemsCfg = (cfg.gems ?? {}) as Json;
  if (gemsCfg.enabled !== true) return json({ error: "Exchange isn't available." });

  const rate = typeof gemsCfg.exchangeRate === "number" && gemsCfg.exchangeRate > 0 ? gemsCfg.exchangeRate : 10;
  const min = typeof gemsCfg.exchangeMin === "number" && gemsCfg.exchangeMin > 0 ? gemsCfg.exchangeMin : 10;
  const amount = Math.floor(gemsWanted);
  if (!Number.isFinite(amount) || amount < min) {
    return json({ error: `Exchange at least ${min} gems.` });
  }

  const extId = `gemx:${userId}:${key ?? crypto.randomUUID()}`;
  const { data, error } = await admin.rpc("gems_exchange", {
    p_user: userId,
    p_gems: amount,
    p_rate: rate,
    p_ext_id: extId,
  });
  if (error) {
    return json({ error: error.message.includes("insufficient") ? "Not enough gems." : "Exchange failed." });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return json({ gems: (row?.gems as number | null) ?? 0, balance: (row?.balance as number | null) ?? 0 });
}

/**
 * Once per UTC day, growing with the streak.
 *
 * The claim-the-day and credit-the-coins halves are ONE transaction inside
 * daily_bonus_claim (0033). They used to be a CAS here followed by a separate
 * wallet_apply, which could burn the day and then fail to pay — the player
 * saw a "+50" celebration with an unchanged balance and no way to retry.
 * Anything short of both halves landing now rolls back to neither.
 */
export async function opDailyBonus(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "dailyBonus", LIMITS.dailyBonus))) return rateLimited();
  const today = utcDay();

  const { data, error } = await admin.rpc("daily_bonus_claim", {
    p_user: userId,
    p_base: DAILY_BONUS_BASE,
    p_step: DAILY_STREAK_STEP,
    p_max: DAILY_STREAK_MAX,
  });
  // A failed claim must NOT read as "already claimed" — that is what told
  // players with a flaky connection the bonus was gone for the day. Surface the
  // error so the client can offer the button again.
  if (error) return json({ error: "Could not claim the bonus. Try again." });

  const row = (Array.isArray(data) ? data[0] : data) as
    | { balance: number; streak_day: number; claimed: number; already: boolean }
    | null;
  if (!row) return json({ error: "Could not claim the bonus. Try again." });

  const streak = row.streak_day;
  const w = await readWallet(admin, userId);
  if (row.already) {
    return json({
      balance: row.balance,
      gems: w.gems,
      streakDay: streak,
      claimed: 0,
      gemsClaimed: 0,
      bonusClaimable: false,
    });
  }

  // Streak finale also pays gems (0027). Separate ledger, so it keeps its own
  // replay guard: the claim above owns the DAY, and this ext_id owns the GEMS —
  // a retry that lands after the claim but before this still cannot double-pay.
  const cfg = await serverConfig(admin);
  const gemsCfg = (cfg.gems ?? {}) as Json;
  const economyCfg = (cfg.economy ?? {}) as Json;
  const gemDay = positiveNumber(economyCfg.gemDay, DAILY_GEM_DAY);
  const gemAmount = positiveNumber(economyCfg.gemAmount, DAILY_GEM_AMOUNT);

  let gems = w.gems;
  let gemsClaimed = 0;
  if (gemsCfg.enabled === true && streak === gemDay) {
    const next = await gemApply(admin, userId, gemAmount, "daily-bonus", `daily-gems:${userId}:${today}`);
    if (next !== null) {
      gems = next;
      gemsClaimed = gemAmount;
    }
  }

  return json({
    balance: row.balance,
    gems,
    streakDay: streak,
    claimed: row.claimed,
    gemsClaimed,
    bonusClaimable: false,
  });
}

export async function opWalletTopup(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "walletTopup", LIMITS.walletTopup))) return rateLimited();
  const w = await readWallet(admin, userId);
  if (!pityReady(w)) return json({ balance: w.balance, granted: 0 });

  // CAS on last_pity_at so concurrent calls can't double-grant.
  const stamp = admin.from("wallets").update({ last_pity_at: new Date().toISOString() }).eq("user_id", userId);
  const { data: claimed } = await (w.last_pity_at === null
    ? stamp.is("last_pity_at", null)
    : stamp.eq("last_pity_at", w.last_pity_at)
  ).select("user_id").maybeSingle();
  if (!claimed) return json({ balance: w.balance, granted: 0 });

  const balance = await walletApply(admin, userId, QUICK_STAKE, "pity-topup", null);
  return json({ balance: balance ?? w.balance, granted: QUICK_STAKE });
}

// --- Rewarded ads ------------------------------------------------------------
// Two-phase by design. The client asks for an INTENT (this grants nothing), the
// ad plays, and AdMob's signed server-to-server callback is what actually
// credits coins — see functions/ads-ssv. A client that lies, replays, or skips
// the ad entirely gets nothing, which matters because these coins are staked
// against other players and will later be purchasable with real money.
export async function opAdRewardIntent(
  admin: SupabaseClient,
  userId: string,
  placement: string,
  gameId: string | null,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "adReward", LIMITS.adReward))) return rateLimited();
  if (!(placement in REWARD_COINS)) return json({ error: "Unknown placement." });

  const currency = REWARD_CURRENCY[placement] ?? "coins";

  // Gem grants are the one placement whose amount and cap are operator-tunable
  // per region, since they are the closest an ad gets to the paid tier.
  let cap = REWARD_DAILY_CAP[placement] ?? 0;
  let coins = REWARD_COINS[placement];
  if (currency === "gems") {
    const cfg = await serverConfig(admin);
    const gemsCfg = (cfg.gems ?? {}) as Json;
    if (gemsCfg.enabled !== true) return json({ error: "Nothing to award here." });
    const adGrant = (gemsCfg.adGrant ?? {}) as Json;
    coins = positiveNumber(adGrant.amount, REWARD_COINS[placement]!);
    cap = positiveNumber(adGrant.dailyCap, REWARD_DAILY_CAP[placement]!);
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin
    .from("ad_rewards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("placement", placement)
    .eq("status", "granted")
    .gte("created_at", since);
  if ((count ?? 0) >= cap) {
    return json({ error: "That's all the ad rewards for today — try again tomorrow." });
  }

  if (placement === "double-pot") {
    // Half the pot again, house-funded. Post-match and paid by us, never
    // debited from the loser — a reward may never come out of an opponent.
    if (!gameId) return json({ error: "Missing game." });
    const { data: g } = await admin.from("games").select("stake, state").eq("id", gameId).single();
    const stake = (g?.stake as number | null) ?? 0;
    const seats = ((g?.state as GameState | null)?.players ?? []).length;
    coins = Math.floor((stake * seats) / 2);
  }
  if (coins <= 0) return json({ error: "Nothing to award here." });

  const { data: row, error } = await admin
    .from("ad_rewards")
    .insert({ user_id: userId, placement, coins, game_id: gameId, currency })
    .select("id, coins, currency")
    .single();
  if (error || !row) return json({ error: error?.message ?? "Could not start the reward." });

  return json({ nonce: row.id as string, coins: row.coins as number, currency: row.currency as string });
}

/** Polled after the ad reports EARNED_REWARD, until SSV lands. */
export async function opAdRewardStatus(admin: SupabaseClient, userId: string, nonce: string): Promise<Response> {
  const { data } = await admin
    .from("ad_rewards")
    .select("status, coins, currency")
    .eq("id", nonce)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return json({ error: "Unknown reward." });
  const w = await readWallet(admin, userId);
  return json({
    status: data.status as string,
    coins: data.coins as number,
    currency: (data.currency as string | null) ?? "coins",
    balance: w.balance,
    gems: w.gems,
  });
}

// --- Shop --------------------------------------------------------------------

export async function opEntitlementsGet(admin: SupabaseClient, userId: string): Promise<Response> {
  // Grandfather: pricing the cosmetics came AFTER people had already picked
  // them, so anyone already wearing a now-paid avatar keeps it for free. Taking
  // something back that a player is currently using is never worth the coins.
  const { data: profile } = await admin
    .from("profiles")
    .select("avatar_id")
    .eq("user_id", userId)
    .maybeSingle();
  const wornSku = profile?.avatar_id ? `avatar.${profile.avatar_id as string}` : null;
  if (wornSku) {
    await admin
      .from("entitlements")
      .insert({ user_id: userId, sku: wornSku, source: "grant" })
      .select("sku")
      .maybeSingle();
    // Duplicate key = already granted, which is the normal path. Ignored.
  }

  const [owned, catalog] = await Promise.all([
    admin.from("entitlements").select("sku").eq("user_id", userId),
    admin.from("catalog").select("sku, kind, price, currency, active").eq("active", true),
  ]);
  return json({
    skus: (owned.data ?? []).map((r) => r.sku as string),
    catalog: catalog.data ?? [],
  });
}

/** Buy a cosmetic. Price AND currency come from the catalog, never from the
 *  client, and the debit is what gates the grant — no debit, no entitlement. */
export async function opShopBuy(admin: SupabaseClient, userId: string, sku: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "shopBuy", LIMITS.shopBuy))) return rateLimited();
  const { data: item } = await admin
    .from("catalog")
    .select("sku, price, currency, active")
    .eq("sku", sku)
    .maybeSingle();
  if (!item || !item.active) return json({ error: "That item isn't available." });

  const { data: already } = await admin
    .from("entitlements")
    .select("sku")
    .eq("user_id", userId)
    .eq("sku", sku)
    .maybeSingle();
  if (already) return json({ error: "You already own that." });

  const price = (item.price as number | null) ?? 0;
  const inGems = item.currency === "gems";
  if (price > 0) {
    const paid = inGems
      ? await gemApply(admin, userId, -price, `shop:${sku}`)
      : await walletApply(admin, userId, -price, "shop-purchase", null);
    if (paid === null) return json({ error: inGems ? "Not enough gems." : "Not enough coins." });
  }

  const { error } = await admin
    .from("entitlements")
    .insert({ user_id: userId, sku, source: inGems ? "gems" : "coins" });
  if (error) {
    // Refund rather than silently pocketing the currency.
    if (price > 0) {
      if (inGems) await gemApply(admin, userId, price, "shop-refund");
      else await walletApply(admin, userId, price, "shop-refund", null);
    }
    return json({ error: "Could not complete the purchase." });
  }

  const w = await readWallet(admin, userId);
  return json({ sku, balance: w.balance, gems: w.gems });
}

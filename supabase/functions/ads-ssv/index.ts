/**
 * AdMob rewarded-ad server-side verification (SSV).
 *
 * This is the ONLY thing that credits coins for a rewarded ad. The client never
 * grants anything: it asks the `game` function for an intent (a pending
 * ad_rewards row with the amount frozen server-side), shows the ad with that
 * row's id as SSV customData, and then polls. Google calls this endpoint
 * directly with a signed payload; we verify the signature and credit.
 *
 * That indirection is what makes the coins un-mintable — which matters because
 * they're staked against other players and will later be purchasable.
 *
 * Deployed WITHOUT jwt verification (Google calls it unauthenticated). The
 * ECDSA signature is the authentication.
 *
 *   supabase functions deploy ads-ssv --no-verify-jwt
 *
 * Reference: https://developers.google.com/admob/android/ssv
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Canonical host: the bare gstatic.com in Google's docs 301s to www, and
// relying on redirect-following for a security-critical key fetch is a needless
// dependency on fetch policy.
const KEY_SERVER = "https://www.gstatic.com/admob/reward/verifier-keys.json";

interface VerifierKey {
  keyId: number;
  pem: string;
  base64: string;
}

let keyCache: { fetchedAt: number; keys: VerifierKey[] } | null = null;
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

async function verifierKeys(): Promise<VerifierKey[]> {
  if (keyCache && Date.now() - keyCache.fetchedAt < KEY_TTL_MS) return keyCache.keys;
  const res = await fetch(KEY_SERVER);
  if (!res.ok) throw new Error(`verifier keys ${res.status}`);
  const body = (await res.json()) as { keys: VerifierKey[] };
  keyCache = { fetchedAt: Date.now(), keys: body.keys ?? [] };
  return keyCache.keys;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * AdMob signs with ASN.1 DER (`SEQUENCE { INTEGER r, INTEGER s }`) but WebCrypto
 * expects the raw r‖s pair, 32 bytes each for P-256. DER integers are signed,
 * so they carry a leading 0x00 when the high bit is set and may be short when
 * the value has leading zero bytes — both have to be normalised to exactly 32.
 */
function derToRaw(der: Uint8Array): Uint8Array {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER: no SEQUENCE");
  // Length byte(s) — skip the long-form count if present.
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
  else i += 1;

  const readInt = (): Uint8Array => {
    if (der[i++] !== 0x02) throw new Error("bad DER: no INTEGER");
    const len = der[i++];
    let bytes = der.slice(i, i + len);
    i += len;
    // Strip sign padding, then left-pad to 32.
    while (bytes.length > 32 && bytes[0] === 0x00) bytes = bytes.slice(1);
    if (bytes.length > 32) throw new Error("bad DER: integer too long");
    const padded = new Uint8Array(32);
    padded.set(bytes, 32 - bytes.length);
    return padded;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/**
 * Google signs the query string up to (but excluding) `&signature=`. Order and
 * encoding must be preserved exactly as received — so this works off the raw
 * query text, never a re-serialised URLSearchParams.
 */
function signedPortion(rawQuery: string): string | null {
  const idx = rawQuery.indexOf("&signature=");
  if (idx === -1) return null;
  return rawQuery.slice(0, idx);
}

async function verifySignature(rawQuery: string, keyId: string, signatureB64: string): Promise<boolean> {
  const payload = signedPortion(rawQuery);
  if (!payload) return false;

  const keys = await verifierKeys();
  const key = keys.find((k) => String(k.keyId) === String(keyId));
  if (!key) return false;

  const pub = await crypto.subtle.importKey(
    "spki",
    b64ToBytes(key.base64),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  let raw: Uint8Array;
  try {
    raw = derToRaw(b64ToBytes(signatureB64));
  } catch {
    return false;
  }

  return await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pub,
    raw,
    new TextEncoder().encode(payload),
  );
}

/** Google requires 200 for SSV callbacks and retries up to 5x on anything else.
 *  Non-2xx is therefore reserved for genuinely transient failures we WANT
 *  retried — never for "this request grants nothing", which is a settled
 *  outcome. Security doesn't depend on the status code: no coins move without
 *  a verified signature and a matching pending row. */
const handled = (msg: string) => new Response(msg, { status: 200 });

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const q = url.searchParams;

    const signature = q.get("signature");
    const keyId = q.get("key_id");
    const customData = q.get("custom_data");
    const transactionId = q.get("transaction_id");
    const userId = q.get("user_id");

    if (!signature || !keyId) {
      console.warn("ssv: unsigned request", url.search);
      return handled("no signature");
    }

    const ok = await verifySignature(url.search.replace(/^\?/, ""), keyId, signature);
    if (!ok) {
      console.warn("ssv: signature rejected", url.search);
      return handled("bad signature");
    }

    // AdMob's "send test callback" button is validly signed but carries no
    // custom_data — that only exists on a real ad request made by the app.
    // Nothing to grant, but the wiring is proven, so acknowledge it.
    if (!customData || !transactionId) {
      console.log("ssv: verified callback with no reward payload (test callback)");
      return handled("ok (no reward payload)");
    }

    const admin: SupabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // custom_data is the ad_rewards row id we minted at intent time. The coin
    // amount comes from that row — never from the callback.
    const { data: row } = await admin
      .from("ad_rewards")
      .select("id, user_id, coins, status, game_id, expires_at")
      .eq("id", customData)
      .maybeSingle();

    if (!row) return handled("unknown reward");
    if (row.status === "granted") return handled("already granted");
    if (userId && row.user_id !== userId) {
      console.warn("ssv: user mismatch", { row: row.user_id, callback: userId });
      return handled("user mismatch");
    }

    if (new Date(row.expires_at as string).getTime() < Date.now()) {
      await admin.from("ad_rewards").update({ status: "expired" }).eq("id", row.id).eq("status", "pending");
      return handled("expired");
    }

    // Claim the row first: whoever flips pending -> granted owns the payout, so
    // concurrent callbacks can't double-credit.
    const { data: claimed } = await admin
      .from("ad_rewards")
      .update({ status: "granted", txn_ext_id: transactionId })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) return handled("already settled");

    // ext_id makes this idempotent even if the claim raced.
    const { error } = await admin.rpc("wallet_apply", {
      p_user: row.user_id,
      p_delta: row.coins,
      p_reason: "ad-reward",
      p_game: row.game_id,
      p_bucket: "earned",
      p_ext_id: `ssv:${transactionId}`,
    });
    if (error) {
      // Credit failed after claiming — release so a retry can settle it.
      await admin.from("ad_rewards").update({ status: "pending" }).eq("id", row.id);
      return new Response("credit failed", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "error", { status: 500 });
  }
});

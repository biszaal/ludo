/**
 * Currency primitives. Every balance change in the app goes through one of
 * these two RPCs — atomic, overdraw-guarded, and ledgered on the DB side.
 *
 * FAIRNESS INVARIANT: coins buy ACCESS (match entry) and APPEARANCE (themes,
 * avatars). Never outcome. No rewarded or purchased mechanic may improve a
 * player's chance of winning a match — that is what keeps a coin-staked PvP
 * game defensible once coins are real-money purchasable.
 */

import type { SupabaseClient } from "./lib.ts";

/** Returns the new balance, or null when a debit would overdraw (or the RPC failed). */
export async function walletApply(
  admin: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  gameId: string | null,
  bucket: "earned" | "purchased" = "earned",
  extId: string | null = null,
): Promise<number | null> {
  const { data, error } = await admin.rpc("wallet_apply", {
    p_user: userId,
    p_delta: delta,
    p_reason: reason,
    p_game: gameId,
    p_bucket: bucket,
    p_ext_id: extId,
  });
  if (error) return null;
  return (data as number | null) ?? null;
}

/** Returns the new gem count, or null when a debit would overdraw. */
export async function gemApply(
  admin: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  extId: string | null = null,
): Promise<number | null> {
  const { data, error } = await admin.rpc("gem_apply", {
    p_user: userId,
    p_delta: delta,
    p_reason: reason,
    p_ext_id: extId,
  });
  if (error) return null;
  return (data as number | null) ?? null;
}

export interface WalletRow {
  balance: number;
  purchased_balance: number;
  gems: number;
  last_bonus_on: string | null;
  streak_day: number;
  last_pity_at: string | null;
}

/** Read the caller's wallet, creating it on first touch. One round trip: the
 *  create-if-missing and the read happen inside wallet_read (0022), where they
 *  used to be an upsert followed by a select from here. */
export async function readWallet(admin: SupabaseClient, userId: string): Promise<WalletRow> {
  const { data } = await admin.rpc("wallet_read", { p_user: userId });
  const row = (Array.isArray(data) ? data[0] : data) as Partial<WalletRow> | null;
  return {
    balance: row?.balance ?? 0,
    purchased_balance: row?.purchased_balance ?? 0,
    gems: row?.gems ?? 0,
    last_bonus_on: row?.last_bonus_on ?? null,
    streak_day: row?.streak_day ?? 0,
    last_pity_at: row?.last_pity_at ?? null,
  };
}

/** A broke player is never hard-stuck: one small grant a day, only at zero.
 *  Replaces 0010's unlimited floor top-up, which made coins meaningless. */
export function pityReady(w: WalletRow): boolean {
  if (w.balance > 0) return false;
  if (!w.last_pity_at) return true;
  return Date.now() - new Date(w.last_pity_at).getTime() >= 86_400_000;
}

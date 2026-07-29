/**
 * Rewarded-ad orchestration: the three-step dance that makes a client unable to
 * mint coins.
 *
 *   1. Ask the server for an INTENT. It mints a pending row with the coin
 *      amount frozen server-side and hands back a nonce. Grants nothing.
 *   2. Show the ad, passing that nonce as SSV customData.
 *   3. AdMob's signed server-to-server callback credits the coins. We only
 *      POLL for that to land.
 *
 * Step 3 is the whole point: the client never credits anything, so a tampered
 * app, a replayed callback, or a skipped ad all yield nothing. That matters
 * here more than in a typical game because these coins are staked against
 * other players and will later be purchasable with real money.
 *
 * Nothing this file grants may affect a match outcome — rewarded ads buy
 * ACCESS (an entry fee) or PAYOUT (a house-funded bonus), never advantage.
 */

import * as api from "../../net/api";
import { showRewarded } from "./provider";
import { useAds } from "../../store/adsStore";
import { useWallet } from "../../store/walletStore";

export type RewardResult =
  | { status: "granted"; coins: number }
  | { status: "pending"; coins: number }
  | { status: "dismissed" }
  | { status: "unavailable"; message?: string };

/** How long to wait for the SSV callback before telling the player it's late. */
const POLL_TIMEOUT_MS = 8000;
const POLL_INTERVAL_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run one rewarded placement end to end.
 *
 * `gameId` is required for "double-pot" (the server sizes the bonus from that
 * game's stake and seat count).
 */
export async function watchForReward(
  placement: api.RewardPlacement,
  gameId?: string,
): Promise<RewardResult> {
  let nonce: string;
  let coins: number;
  let userId: string;

  try {
    userId = await api.ensureSignedIn();
    const intent = await api.adRewardIntent(placement, gameId);
    nonce = intent.nonce;
    coins = intent.coins;
  } catch (e) {
    // Daily cap, unknown placement, or offline — all surface as one message.
    return { status: "unavailable", message: e instanceof Error ? e.message : undefined };
  }

  const outcome = await showRewarded(nonce, userId);
  if (outcome === "failed") return { status: "unavailable" };
  if (outcome === "dismissed") return { status: "dismissed" };

  useAds.getState().noteRewardedShown();

  // The ad says the reward was earned; the server is what makes it real.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await api.adRewardStatus(nonce);
      if (res.status === "granted") {
        await useWallet.getState().refresh();
        return { status: "granted", coins: res.coins };
      }
      if (res.status === "expired") return { status: "unavailable" };
    } catch {
      // Transient — keep polling until the deadline.
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // SSV hasn't landed yet. It usually still will; the balance reconciles on the
  // next wallet refresh. Never self-grant here.
  void useWallet.getState().refresh();
  return { status: "pending", coins };
}

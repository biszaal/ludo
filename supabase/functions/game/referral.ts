/**
 * Referral programme (0082): the edge side.
 *
 * Every rule (who can be referred, when a referral pays, the caps, whether the
 * programme is on at all) lives in SQL so it can be tuned without a deploy. This
 * module only calls those functions from the right places:
 *
 *   * attachReferral: from a friend-code lookup and from a friend-room join;
 *   * settleReferrals: after a game settles, and from the router's activity hook,
 *     so a friend who played on day one is paid on their first request of a
 *     later day;
 *   * opReferrals: the invite card.
 *
 * None of it may break the call it rides on. Attach and settle swallow their own
 * errors; a referral that fails to record or pay is retried by the next lookup,
 * game or visit.
 */

import { json, LIMITS, rateOk, type SupabaseClient } from "./lib.ts";
import { displayNameOf, sendPush } from "./push.ts";

export type ReferralAttach =
  | { attached: false }
  | { attached: true; inviteeCoins: number; gamesRequired: number };

interface Payout {
  paid: true;
  referralId: string;
  inviterUserId: string;
  inviteeUserId: string;
  inviterPaid: boolean;
  inviterCoins: number;
  inviteeCoins: number;
}

/** Record that `inviteeId` was brought by `inviterId`. Never throws. */
export async function attachReferral(
  admin: SupabaseClient,
  inviteeId: string,
  inviterId: string,
  source: "code" | "room",
): Promise<ReferralAttach> {
  try {
    const { data, error } = await admin.rpc("referral_attach", {
      p_invitee: inviteeId,
      p_inviter: inviterId,
      p_source: source,
    });
    if (error || !data || (data as { attached?: unknown }).attached !== true) return { attached: false };
    const d = data as { inviteeCoins: number; gamesRequired: number };
    return { attached: true, inviteeCoins: Number(d.inviteeCoins), gamesRequired: Number(d.gamesRequired) };
  } catch {
    return { attached: false };
  }
}

/** Pay any of these players whose referral now qualifies, and tell both sides. Never throws. */
export async function settleReferrals(
  admin: SupabaseClient,
  userIds: string[],
  push: typeof sendPush = sendPush,
): Promise<void> {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    try {
      const { data, error } = await admin.rpc("referral_settle", { p_invitee: userId });
      if (error || !data || (data as { paid?: unknown }).paid !== true) continue;
      await announce(admin, data as Payout, push);
    } catch {
      // The next game or visit retries; a payout is never lost, only delayed.
    }
  }
}

async function announce(admin: SupabaseClient, p: Payout, push: typeof sendPush): Promise<void> {
  const [inviterName, inviteeName] = await Promise.all([
    displayNameOf(admin, p.inviterUserId),
    displayNameOf(admin, p.inviteeUserId),
  ]);
  const sends: Promise<void>[] = [
    push(admin, [p.inviteeUserId], {
      title: `You earned ${p.inviteeCoins} coins`,
      body: `Thanks for joining ${inviterName}.`,
      data: { type: "referral" },
    }),
  ];
  if (p.inviterPaid) {
    sends.push(
      push(admin, [p.inviterUserId], {
        title: `You earned ${p.inviterCoins} coins`,
        body: `${inviteeName} played 2 games.`,
        data: { type: "referral" },
      }),
    );
  }
  await Promise.allSettled(sends);
}

/** The invite card: who this player brought, who brought them, and the offer. */
export async function opReferrals(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "referrals", LIMITS.referrals))) {
    return json({ error: "Too many requests. Try again in a minute." });
  }
  const { data, error } = await admin.rpc("referral_list", { p_user: userId });
  if (error || !data) return json({ error: "Could not load invites." });
  return json(data);
}

/**
 * Referral programme (0082): what the invite card and the reward pop-up say.
 *
 * Pure, so the rules are testable without React Native. Every number comes from
 * the server's reply (`config`), never from a client constant: the programme
 * is tuned in app_config, and an old app must show what the server pays.
 */

import type { useT } from "../i18n";

export type Translate = ReturnType<typeof useT>;

export type ReferralState = "playing" | "nextDay" | "rewarded" | "capped";

export interface ReferralFriend {
  id: string;
  /** The other player's username; null for a guest who never chose one. */
  name: string | null;
  avatarId: string | null;
  gamesPlayed: number;
  state: ReferralState;
  rewardedAt: string | null;
}

export interface ReferralsResponse {
  config: { enabled: boolean; inviterCoins: number; inviteeCoins: number; gamesRequired: number };
  /** Friends this player brought, newest first. */
  invited: ReferralFriend[];
  /** Who brought this player, if anyone. */
  invitedBy: ReferralFriend | null;
}

export interface CardRow {
  id: string;
  name: string;
  status: string;
  done: boolean;
}

/** One line per invited friend: their name and how far along they are. */
export function cardRows(r: ReferralsResponse, t: Translate): CardRow[] {
  const { gamesRequired, inviterCoins } = r.config;
  return r.invited.map((f) => ({
    id: f.id,
    name: f.name ?? t("referral.newPlayer"),
    status:
      f.state === "playing"
        ? t("referral.playing", { played: f.gamesPlayed, games: gamesRequired })
        : f.state === "nextDay"
          ? t("referral.nextDay")
          : f.state === "rewarded"
            ? t("referral.rewarded", { coins: inviterCoins })
            : t("referral.capped"),
    done: f.state === "rewarded" || f.state === "capped",
  }));
}

export interface Announcement {
  key: string;
  coins: number;
  name: string | null;
  side: "inviter" | "invitee";
}

/**
 * Rewards that have landed but not yet had their pop-up on this device.
 *
 * The inviter hears about each friend who paid out. The invitee hears about
 * their own reward even when the inviter was capped (state "capped"), because
 * the invitee was still paid.
 *
 * Only rewards from the last 7 days: the announced list lives on the device, so
 * a reinstall or a second phone would otherwise replay every reward ever paid,
 * one pop-up after another. A reward with no date counts as recent.
 */
export function unannounced(r: ReferralsResponse, announced: readonly string[], now = Date.now()): Announcement[] {
  const seen = new Set(announced);
  const recent = (f: ReferralFriend) => !f.rewardedAt || now - Date.parse(f.rewardedAt) <= ANNOUNCE_WINDOW_MS;
  const out: Announcement[] = [];
  for (const f of r.invited) {
    if (f.state === "rewarded" && recent(f)) {
      out.push({ key: `${f.id}:inviter`, coins: r.config.inviterCoins, name: f.name, side: "inviter" });
    }
  }
  const by = r.invitedBy;
  if (by && (by.state === "rewarded" || by.state === "capped") && recent(by)) {
    out.push({ key: `${by.id}:invitee`, coins: r.config.inviteeCoins, name: by.name, side: "invitee" });
  }
  return out.filter((a) => !seen.has(a.key));
}

const ANNOUNCE_WINDOW_MS = 7 * 24 * 60 * 60_000;

/** The friend-code share text; it mentions the reward only while the programme is on. */
export function friendShareMessage(t: Translate, name: string, code: string, url: string, rewardOn: boolean): string {
  return t(rewardOn ? "invite.friendMessageReward" : "invite.friendMessage", { name, code, url });
}

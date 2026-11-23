/**
 * Referral programme, app side: what the invite card says for each friend,
 * which rewards still need their pop-up, the share message, and the store's
 * behaviour when the programme is off or the server call fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/net/api", () => ({ getReferrals: vi.fn() }));

import * as api from "../src/net/api";
import { LOCALES, translate, type Locale } from "../src/i18n";
import { cardRows, challengeShareMessage, friendShareMessage, unannounced, type ReferralsResponse } from "../src/lib/referrals";
import { useReferrals } from "../src/store/referralStore";

const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("en", key, params);
const URL_ = "https://www.biszaaltech.com/games/ludo";

const friend = (over: Partial<ReferralsResponse["invited"][number]>) => ({
  id: "r1",
  name: "Asha",
  avatarId: "cap",
  gamesPlayed: 0,
  state: "playing" as const,
  rewardedAt: null,
  ...over,
});

const response = (over: Partial<ReferralsResponse> = {}): ReferralsResponse => ({
  config: { enabled: true, inviterCoins: 200, inviteeCoins: 100, gamesRequired: 2 },
  invited: [],
  invitedBy: null,
  ...over,
});

describe("cardRows", () => {
  it("maps each state to its line", () => {
    const r = response({
      invited: [
        friend({ id: "a", gamesPlayed: 1, state: "playing" }),
        friend({ id: "b", gamesPlayed: 2, state: "nextDay" }),
        friend({ id: "c", gamesPlayed: 2, state: "rewarded" }),
        friend({ id: "d", gamesPlayed: 2, state: "capped" }),
      ],
    });
    expect(cardRows(r, en).map((row) => [row.id, row.status, row.done])).toEqual([
      ["a", "1 of 2 games", false],
      ["b", en("referral.nextDay"), false],
      ["c", "✓ 200 coins", true],
      ["d", en("referral.capped"), true],
    ]);
  });

  it("names a friend with no profile 'New player'", () => {
    const rows = cardRows(response({ invited: [friend({ name: null })] }), en);
    expect(rows[0]!.name).toBe(en("referral.newPlayer"));
  });
});

describe("unannounced", () => {
  const r = response({
    invited: [friend({ id: "x", state: "rewarded" })],
    invitedBy: friend({ id: "y", name: "Ravi", state: "rewarded" }),
  });

  it("announces each reward once per side", () => {
    const first = unannounced(r, []);
    expect(first).toEqual([
      { key: "x:inviter", coins: 200, name: "Asha", side: "inviter" },
      { key: "y:invitee", coins: 100, name: "Ravi", side: "invitee" },
    ]);
    expect(unannounced(r, first.map((a) => a.key))).toEqual([]);
  });

  it("does not announce pending friends", () => {
    const pending = response({ invited: [friend({ state: "nextDay" })], invitedBy: friend({ id: "y", state: "playing" }) });
    expect(unannounced(pending, [])).toEqual([]);
  });

  it("skips rewards older than 7 days, so a new device doesn't replay a history of pop-ups", () => {
    const now = Date.parse("2026-12-01T00:00:00Z");
    const r2 = response({
      invited: [
        friend({ id: "old", state: "rewarded", rewardedAt: "2026-11-20T00:00:00Z" }),
        friend({ id: "new", state: "rewarded", rewardedAt: "2026-11-28T00:00:00Z" }),
      ],
    });
    expect(unannounced(r2, [], now).map((a) => a.key)).toEqual(["new:inviter"]);
  });

  it("still tells the invitee when the inviter was capped", () => {
    const capped = response({ invitedBy: friend({ id: "y", state: "capped" }) });
    expect(unannounced(capped, []).map((a) => a.key)).toEqual(["y:invitee"]);
  });
});

describe("friendShareMessage", () => {
  it("uses the reward share message only when the programme is on", () => {
    for (const l of LOCALES as readonly Locale[]) {
      const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(l, key, params);
      const on = friendShareMessage(t, "Asha", "K7PXQ2", URL_, true);
      const off = friendShareMessage(t, "Asha", "K7PXQ2", URL_, false);
      for (const msg of [on, off]) {
        expect(msg, l).toContain("K7PXQ2");
        expect(msg, l).toContain(URL_);
      }
      expect(on, l).not.toBe(off);
      expect(off, l).toBe(t("invite.friendMessage", { name: "Asha", code: "K7PXQ2", url: URL_ }));
    }
  });
});

describe("challengeShareMessage", () => {
  it("challenges rather than just adds, carries the code and link, and promises coins only when the programme is on", () => {
    for (const l of LOCALES as readonly Locale[]) {
      const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate(l, key, params);
      const on = challengeShareMessage(t, "Asha", "K7PXQ2", URL_, true);
      const off = challengeShareMessage(t, "Asha", "K7PXQ2", URL_, false);
      for (const msg of [on, off]) {
        expect(msg, l).toContain("K7PXQ2");
        expect(msg, l).toContain(URL_);
      }
      expect(on, l).not.toBe(off);
      expect(off, l).toBe(t("invite.challengeMessage", { name: "Asha", code: "K7PXQ2", url: URL_ }));
      expect(off, l).not.toBe(friendShareMessage(t, "Asha", "K7PXQ2", URL_, false));
    }
  });
});

describe("useReferrals", () => {
  beforeEach(() => {
    useReferrals.setState({ data: null, loadedAt: 0, announced: [] });
    vi.mocked(api.getReferrals).mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("load keeps data null when the op fails", async () => {
    vi.mocked(api.getReferrals).mockRejectedValue(new Error("offline"));
    await useReferrals.getState().load({ force: true });
    expect(useReferrals.getState().data).toBeNull();
  });

  it("load skips a second fetch within 5 minutes unless forced", async () => {
    vi.useFakeTimers();
    vi.mocked(api.getReferrals).mockResolvedValue(response());
    await useReferrals.getState().load();
    await useReferrals.getState().load();
    expect(api.getReferrals).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await useReferrals.getState().load();
    expect(api.getReferrals).toHaveBeenCalledTimes(2);
    await useReferrals.getState().load({ force: true });
    expect(api.getReferrals).toHaveBeenCalledTimes(3);
  });

  it("markAnnounced remembers keys without duplicates", () => {
    useReferrals.getState().markAnnounced(["x:inviter"]);
    useReferrals.getState().markAnnounced(["x:inviter", "y:invitee"]);
    expect(useReferrals.getState().announced).toEqual(["x:inviter", "y:invitee"]);
  });
});

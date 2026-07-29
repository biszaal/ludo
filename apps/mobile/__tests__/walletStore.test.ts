/**
 * Wallet store: server-balance mirror.
 *
 * The headline behaviour here is a REMOVAL. 0010 silently topped any balance
 * under 100 back up on every refresh, so coins could never run out; the store
 * must now mirror a low balance untouched and leave topping up to an explicit
 * player action.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../src/net/api", () => ({
  getWalletState: vi.fn(),
  claimDailyBonus: vi.fn(),
  topupWallet: vi.fn(),
  gemsBuy: vi.fn(),
  gemsExchange: vi.fn(),
}));

import * as api from "../src/net/api";
import { useWallet } from "../src/store/walletStore";

const state = (over: Partial<api.WalletState> = {}): api.WalletState => ({
  balance: 500,
  purchasedBalance: 0,
  streakDay: 0,
  bonusClaimable: false,
  pityAvailable: false,
  ...over,
});

afterEach(() => {
  useWallet.setState({
    balance: null,
    purchasedBalance: 0,
    gems: null,
    streakDay: 0,
    bonusClaimable: false,
    pityAvailable: false,
    refreshing: false,
  });
  vi.clearAllMocks();
});

describe("wallet refresh", () => {
  it("mirrors a healthy balance", async () => {
    vi.mocked(api.getWalletState).mockResolvedValue(state({ balance: 500 }));
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(500);
    expect(api.topupWallet).not.toHaveBeenCalled();
  });

  it("mirrors a low balance as-is and never tops it up", async () => {
    vi.mocked(api.getWalletState).mockResolvedValue(state({ balance: 40 }));
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(40);
    expect(api.topupWallet).not.toHaveBeenCalled();
  });

  it("mirrors a zero balance without rescuing the player", async () => {
    vi.mocked(api.getWalletState).mockResolvedValue(state({ balance: 0, pityAvailable: true }));
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(0);
    expect(useWallet.getState().pityAvailable).toBe(true);
    expect(api.topupWallet).not.toHaveBeenCalled();
  });

  it("carries the streak and claimable flags through", async () => {
    vi.mocked(api.getWalletState).mockResolvedValue(state({ streakDay: 3, bonusClaimable: true }));
    await useWallet.getState().refresh();
    expect(useWallet.getState().streakDay).toBe(3);
    expect(useWallet.getState().bonusClaimable).toBe(true);
  });

  it("keeps the last known balance when the network fails", async () => {
    useWallet.setState({ balance: 320 });
    vi.mocked(api.getWalletState).mockRejectedValue(new Error("offline"));
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(320);
    expect(useWallet.getState().refreshing).toBe(false);
  });
});

describe("daily bonus", () => {
  it("credits the balance and clears the claimable flag", async () => {
    useWallet.setState({ balance: 100, bonusClaimable: true });
    vi.mocked(api.claimDailyBonus).mockResolvedValue({ balance: 175, streakDay: 4, claimed: 75 });
    const claimed = await useWallet.getState().claimDailyBonus();
    expect(claimed).toBe(75);
    expect(useWallet.getState().balance).toBe(175);
    expect(useWallet.getState().streakDay).toBe(4);
    expect(useWallet.getState().bonusClaimable).toBe(false);
  });

  it("reports zero when the server says it was already taken", async () => {
    vi.mocked(api.claimDailyBonus).mockResolvedValue({ balance: 175, streakDay: 4, claimed: 0 });
    expect(await useWallet.getState().claimDailyBonus()).toBe(0);
  });
});

describe("gems", () => {
  it("mirrors the gem balance from walletState, defaulting a missing field to 0", async () => {
    vi.mocked(api.getWalletState).mockResolvedValue(state({ gems: 45 }));
    await useWallet.getState().refresh();
    expect(useWallet.getState().gems).toBe(45);

    // An old server omits the field entirely — that's zero, not null.
    vi.mocked(api.getWalletState).mockResolvedValue(state());
    await useWallet.getState().refresh();
    expect(useWallet.getState().gems).toBe(0);
  });

  it("credits a purchased pack and reports the gems gained", async () => {
    useWallet.setState({ gems: 10 });
    vi.mocked(api.gemsBuy).mockResolvedValue({ gems: 70, purchaseId: "p1" });
    expect(await useWallet.getState().buyGems("gems.small")).toBe(60);
    expect(useWallet.getState().gems).toBe(70);
  });

  it("reports zero when the purchase is refused (flag off, stub locked)", async () => {
    useWallet.setState({ gems: 10 });
    vi.mocked(api.gemsBuy).mockRejectedValue(new Error("Purchases aren't available yet."));
    expect(await useWallet.getState().buyGems("gems.small")).toBe(0);
    expect(useWallet.getState().gems).toBe(10);
  });

  it("exchanges gems for coins and mirrors both new balances", async () => {
    useWallet.setState({ gems: 50, balance: 200 });
    vi.mocked(api.gemsExchange).mockResolvedValue({ gems: 40, balance: 300 });
    expect(await useWallet.getState().exchangeGems(10)).toBe(100);
    expect(useWallet.getState().gems).toBe(40);
    expect(useWallet.getState().balance).toBe(300);
  });

  it("sends a fresh idempotency key per exchange call", async () => {
    vi.mocked(api.gemsExchange).mockResolvedValue({ gems: 0, balance: 0 });
    await useWallet.getState().exchangeGems(10);
    await useWallet.getState().exchangeGems(10);
    const keys = vi.mocked(api.gemsExchange).mock.calls.map((c) => c[1]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBeTruthy();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("reports zero and keeps state when the exchange fails", async () => {
    useWallet.setState({ gems: 5, balance: 200 });
    vi.mocked(api.gemsExchange).mockRejectedValue(new Error("Not enough gems."));
    expect(await useWallet.getState().exchangeGems(10)).toBe(0);
    expect(useWallet.getState().gems).toBe(5);
    expect(useWallet.getState().balance).toBe(200);
  });
});

describe("pity grant", () => {
  it("reports the coins actually credited", async () => {
    useWallet.setState({ balance: 0, pityAvailable: true });
    vi.mocked(api.topupWallet).mockResolvedValue(100);
    expect(await useWallet.getState().claimPity()).toBe(100);
    expect(useWallet.getState().pityAvailable).toBe(false);
  });

  it("reports zero when the server refuses a second grant", async () => {
    useWallet.setState({ balance: 0 });
    vi.mocked(api.topupWallet).mockResolvedValue(0);
    expect(await useWallet.getState().claimPity()).toBe(0);
  });
});

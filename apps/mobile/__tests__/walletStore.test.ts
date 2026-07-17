/**
 * Wallet store: server-balance mirror + the invisible floor top-up.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../src/net/api", () => ({
  getWallet: vi.fn(),
  topupWallet: vi.fn(),
}));

import * as api from "../src/net/api";
import { useWallet } from "../src/store/walletStore";

afterEach(() => {
  useWallet.setState({ balance: null, refreshing: false });
  vi.clearAllMocks();
});

describe("wallet refresh", () => {
  it("mirrors a healthy balance without topping up", async () => {
    vi.mocked(api.getWallet).mockResolvedValue(500);
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(500);
    expect(api.topupWallet).not.toHaveBeenCalled();
  });

  it("tops a low balance back up to the floor", async () => {
    vi.mocked(api.getWallet).mockResolvedValue(40);
    vi.mocked(api.topupWallet).mockResolvedValue(100);
    await useWallet.getState().refresh();
    expect(api.topupWallet).toHaveBeenCalledTimes(1);
    expect(useWallet.getState().balance).toBe(100);
  });

  it("keeps the last known balance when the network fails", async () => {
    useWallet.setState({ balance: 320 });
    vi.mocked(api.getWallet).mockRejectedValue(new Error("offline"));
    await useWallet.getState().refresh();
    expect(useWallet.getState().balance).toBe(320);
    expect(useWallet.getState().refreshing).toBe(false);
  });
});

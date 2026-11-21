import { describe, expect, it, vi } from "vitest";
import { INSTALL_SENT_KEY, reportInstallOnce } from "../src/lib/installSource";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe("reportInstallOnce", () => {
  it("sends the Android referrer once, then marks it sent", async () => {
    const store = memory();
    const send = vi.fn(async () => ({ recorded: true }));
    const deps = { platform: "android", readReferrer: async () => "utm_source=invite&friend=K7PXQ2", send, store };
    expect(await reportInstallOnce(deps)).toBe(true);
    expect(send).toHaveBeenCalledWith("android", "utm_source=invite&friend=K7PXQ2");
    expect(store.data.get(INSTALL_SENT_KEY)).toBe("1");
    expect(await reportInstallOnce(deps)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries on the next launch when the send fails", async () => {
    const store = memory();
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await reportInstallOnce({ platform: "android", readReferrer: async () => "", send, store })).toBe(false);
    expect(store.data.has(INSTALL_SENT_KEY)).toBe(false);
  });

  it("retries when the Play referrer service is unavailable", async () => {
    const store = memory();
    const send = vi.fn(async () => ({}));
    const readReferrer = async () => {
      throw new Error("SERVICE_UNAVAILABLE");
    };
    expect(await reportInstallOnce({ platform: "android", readReferrer, send, store })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("does nothing on iOS", async () => {
    const send = vi.fn(async () => ({}));
    expect(await reportInstallOnce({ platform: "ios", readReferrer: async () => "", send, store: memory() })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

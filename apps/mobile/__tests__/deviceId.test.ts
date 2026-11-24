import { describe, expect, it, vi } from "vitest";
import { DEVICE_SENT_KEY, deviceIdFor, reportDeviceOnce } from "../src/lib/deviceId";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

describe("deviceIdFor", () => {
  it("uses the Android ID on Android", async () => {
    const id = await deviceIdFor("android", { androidId: () => "a1b2c3d4e5f60708", keychain: memory(), newId: () => "x" });
    expect(id).toBe("a1b2c3d4e5f60708");
  });

  it("keeps one generated ID in the keychain on iOS", async () => {
    const keychain = memory();
    const newId = vi.fn(() => "6f1c2a9e-0b7d-4e55-9d0a-3c8f2b7e1a44");
    const deps = { androidId: () => null, keychain, newId };
    expect(await deviceIdFor("ios", deps)).toBe("6f1c2a9e-0b7d-4e55-9d0a-3c8f2b7e1a44");
    expect(await deviceIdFor("ios", deps)).toBe("6f1c2a9e-0b7d-4e55-9d0a-3c8f2b7e1a44");
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no usable ID", async () => {
    expect(await deviceIdFor("android", { androidId: () => "", keychain: memory(), newId: () => "x" })).toBeNull();
    expect(await deviceIdFor("web", { androidId: () => null, keychain: memory(), newId: () => "x" })).toBeNull();
  });
});

describe("reportDeviceOnce", () => {
  it("sends once per account", async () => {
    const store = memory();
    const send = vi.fn(async () => {});
    const deps = { deviceId: async () => "a1b2c3d4e5f60708", send, store };
    expect(await reportDeviceOnce("user-1", deps)).toBe(true);
    expect(await reportDeviceOnce("user-1", deps)).toBe(false);
    expect(await reportDeviceOnce("user-2", deps)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(store.data.get(DEVICE_SENT_KEY)!)).toEqual(["user-1", "user-2"]);
  });

  it("tries again next time when the send fails", async () => {
    const store = memory();
    const send = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await reportDeviceOnce("user-1", { deviceId: async () => "a1b2c3d4e5f60708", send, store })).toBe(false);
    expect(store.data.has(DEVICE_SENT_KEY)).toBe(false);
  });

  it("sends nothing without a device ID", async () => {
    const send = vi.fn(async () => {});
    expect(await reportDeviceOnce("user-1", { deviceId: async () => null, send, store: memory() })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

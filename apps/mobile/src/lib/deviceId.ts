/**
 * A stable ID for this phone, sent once per account.
 *
 * It exists for one rule on the server: a referral on a phone that already
 * earned a referral payout pays nothing (0084). The server stores only a
 * salted SHA-256 of it.
 *
 * Android: the Android ID, which survives a reinstall and is scoped to our
 * signing key, so other apps see a different value. iOS: a random ID kept in
 * the keychain, which also survives a reinstall and never leaves this phone
 * through a backup.
 *
 * Pure apart from what is passed in; the native wiring is in installReport.
 */

import type { KeyValue } from "./installSource";

export const DEVICE_SENT_KEY = "ludo-device-sent";
export const KEYCHAIN_DEVICE_KEY = "ludo-device-id";

export interface DeviceIdDeps {
  androidId: () => string | null;
  /** The iOS keychain. */
  keychain: KeyValue;
  newId: () => string;
}

export async function deviceIdFor(platform: string, deps: DeviceIdDeps): Promise<string | null> {
  try {
    if (platform === "android") {
      const id = deps.androidId();
      return id && id.length >= 8 ? id : null;
    }
    if (platform !== "ios") return null;
    const saved = await deps.keychain.getItem(KEYCHAIN_DEVICE_KEY);
    if (saved) return saved;
    const id = deps.newId();
    await deps.keychain.setItem(KEYCHAIN_DEVICE_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export interface ReportDeviceDeps {
  deviceId: () => Promise<string | null>;
  send: (deviceId: string) => Promise<unknown>;
  store: KeyValue;
}

/** True when this call sent the report. A failure is retried next time. */
export async function reportDeviceOnce(userId: string, deps: ReportDeviceDeps): Promise<boolean> {
  try {
    const raw = await deps.store.getItem(DEVICE_SENT_KEY);
    const sent: string[] = raw ? JSON.parse(raw) : [];
    if (sent.includes(userId)) return false;
    const id = await deps.deviceId();
    if (!id) return false;
    await deps.send(id);
    // A handful of accounts at most; the cap only bounds a misbehaving loop.
    await deps.store.setItem(DEVICE_SENT_KEY, JSON.stringify([...sent, userId].slice(-20)));
    return true;
  } catch {
    return false;
  }
}

/** A random v4 UUID. Uses crypto.getRandomValues when the runtime has it. */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Where this Android install came from: the Play install referrer, sent once.
 *
 * The website puts `utm_*` fields and, for a friend's link, a `friend` code in
 * the Play link; Play hands them back here on the first launch. The server
 * keeps only those fields, and a friend code records the referral the same way
 * typing it in Add Friend would. iOS has no install referrer, so it sends
 * nothing.
 *
 * Pure apart from what is passed in; the native wiring is in installReport.
 */

export const INSTALL_SENT_KEY = "ludo-install-source-sent";

export interface KeyValue {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface InstallDeps {
  platform: string;
  /** Play's install referrer string. Rejects when the Play service is unavailable. */
  readReferrer: () => Promise<string>;
  send: (platform: string, referrer: string) => Promise<unknown>;
  store: KeyValue;
}

/** True when this call sent the report. A failure is retried on the next launch. */
export async function reportInstallOnce(deps: InstallDeps): Promise<boolean> {
  if (deps.platform !== "android") return false;
  try {
    if ((await deps.store.getItem(INSTALL_SENT_KEY)) === "1") return false;
    const referrer = await deps.readReferrer();
    await deps.send("android", (referrer ?? "").slice(0, 500));
    await deps.store.setItem(INSTALL_SENT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

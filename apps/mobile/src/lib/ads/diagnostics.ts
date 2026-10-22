/**
 * What the ad stack last said, kept so a phone can show it.
 *
 * Every failure path in this folder is best-effort and swallows its error,
 * which is right for the player and left the developer blind: when ads stopped
 * paying out on 2026-09-25 on both platforms, with no client change, nothing on
 * a device could say whether consent, start-up or AdMob itself was refusing.
 * This records the consent answer, the start-up outcome and each format's last
 * error; Settings shows them on a long-press of the version line.
 *
 * Pure and React-free, so the wording is testable in Node.
 */

export type AdFormat = "banner" | "interstitial" | "rewarded";

export interface AdsDiagnostics {
  sdk: boolean;
  consent: { status: string; canRequestAds: boolean; error: string | null } | null;
  /** null until start-up has finished one way or the other. */
  initialized: boolean | null;
  initError: string | null;
  lastErrors: Partial<Record<AdFormat, { text: string; at: number }>>;
}

export function emptyAdsDiagnostics(): AdsDiagnostics {
  return { sdk: true, consent: null, initialized: null, initError: null, lastErrors: {} };
}

/** An error as one line, whatever shape the SDK handed over. */
export function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown };
    const message = typeof e.message === "string" ? e.message : null;
    if (typeof e.code === "string" || typeof e.code === "number") {
      return message ? `${e.code} — ${message}` : String(e.code);
    }
    if (message) return message;
  }
  return String(err);
}

export function noteAdErrorIn(d: AdsDiagnostics, format: AdFormat, err: unknown, now: number = Date.now()): AdsDiagnostics {
  return { ...d, lastErrors: { ...d.lastErrors, [format]: { text: errorText(err), at: now } } };
}

const FORMATS: AdFormat[] = ["banner", "interstitial", "rewarded"];

export function describeAdsDiagnostics(d: AdsDiagnostics): string[] {
  if (!d.sdk) return ["SDK: missing from this build"];
  const lines: string[] = ["SDK: present"];
  lines.push(
    d.consent
      ? `Consent: ${d.consent.status}, may request ads: ${d.consent.canRequestAds ? "yes" : "no"}` +
          (d.consent.error ? ` (form error: ${d.consent.error})` : "")
      : "Consent: not answered yet",
  );
  lines.push(
    d.initialized === null
      ? "Start-up: not finished"
      : d.initialized
        ? "Start-up: ok"
        : `Start-up: failed${d.initError ? ` — ${d.initError}` : ""}`,
  );
  for (const f of FORMATS) {
    const e = d.lastErrors[f];
    lines.push(e ? `${f}: ${e.text}` : `${f}: no error`);
  }
  return lines;
}

/**
 * Number display shared by every currency surface. Pills show the compact
 * form; the sheet a pill opens shows the exact form — tapping is how the
 * player asks "how much exactly?".
 */

/**
 * Compact wallet form: exact below 1000, then 1.2K / 3.5M / 1B. One decimal,
 * TRUNCATED never rounded up — a wallet pill must never overstate spendable
 * balance (9,999 → "9.9K", not "10K"). Trailing ".0" is dropped (2K, not 2.0K).
 */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  if (n < 0) return `-${formatCompact(-n)}`;
  if (n < 1000) return String(Math.floor(n));
  const units: [number, string][] = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [div, suffix] of units) {
    if (n >= div) {
      const scaled = Math.floor((n / div) * 10) / 10; // one decimal, truncated
      const text = scaled % 1 === 0 ? String(scaled) : scaled.toFixed(1);
      return `${text}${suffix}`;
    }
  }
  return String(Math.floor(n));
}

/** Exact form with thousands separators (347,750) for sheet balance lines. */
export function formatExact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.floor(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Country flags (0083): a two-letter ISO code drawn as the flag emoji.
 *
 * A flag emoji is just the code spelled in "regional indicator" letters, so no
 * image assets are needed and every platform draws its own. Unknown (XX), Tor
 * (T1) and anything malformed give null, which callers render as no flag at all.
 */

const REGIONAL_A = 0x1f1e6;

export function flagEmoji(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c) || c === "XX" || c === "T1") return null;
  return String.fromCodePoint(REGIONAL_A + c.charCodeAt(0) - 65, REGIONAL_A + c.charCodeAt(1) - 65);
}

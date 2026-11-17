/** Display names may use supported writing systems; friend codes remain the
 * stable lookup identity. Strip controls and symbols, normalize canonically,
 * and count Unicode code points like PostgreSQL char_length. */
export const MAX_DISPLAY_NAME_LENGTH = 20;
export function cleanDisplayName(raw: string): string {
  return Array.from(raw.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')).slice(0, MAX_DISPLAY_NAME_LENGTH).join('');
}

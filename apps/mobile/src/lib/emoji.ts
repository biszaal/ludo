/**
 * The reaction-emoji registry: our own sprite set (drawn by
 * scripts/gen-emoji.mjs) plus the per-emoji arrival sound. The chat wire
 * carries the emoji ID in `value` (kind: "reaction"); anything unknown —
 * including raw unicode from older builds — falls back via the legacy map,
 * and failing that renders as plain text so no client version ever breaks.
 */

import type { SoundName } from "./sound";

export interface EmojiSpec {
  id: string;
  /** Sprite asset (require() module id). */
  source: number;
  /** Arrival sound played on the receiving devices. */
  sound: SoundName;
  /** Accessibility label. */
  label: string;
}

export const EMOJIS: EmojiSpec[] = [
  { id: "laugh", source: require("../../assets/emoji/laugh.png"), sound: "laugh", label: "Laughing" },
  { id: "cry", source: require("../../assets/emoji/cry.png"), sound: "crying", label: "Crying" },
  { id: "tease", source: require("../../assets/emoji/tease.png"), sound: "tease", label: "Teasing" },
  { id: "angry", source: require("../../assets/emoji/angry.png"), sound: "angry", label: "Angry" },
  { id: "shock", source: require("../../assets/emoji/shock.png"), sound: "shock", label: "Shocked" },
  { id: "cheer", source: require("../../assets/emoji/cheer.png"), sound: "cheer", label: "Celebrating" },
  { id: "thumbs", source: require("../../assets/emoji/thumbs.png"), sound: "pop", label: "Thumbs up" },
  { id: "gg", source: require("../../assets/emoji/gg.png"), sound: "finish", label: "Good game" },
];

export const EMOJI_BY_ID: Record<string, EmojiSpec> = Object.fromEntries(EMOJIS.map((e) => [e.id, e]));

/** Reactions sent by builds that predate the sprite set (raw unicode). */
const LEGACY: Record<string, string> = {
  "😂": "laugh",
  "😭": "cry",
  "👍": "thumbs",
  "🔥": "cheer",
  "😡": "angry",
  "🎉": "cheer",
};

/** Sprite for a wire value, or null when it should render as plain text. */
export function resolveEmoji(value: string): EmojiSpec | null {
  return EMOJI_BY_ID[value] ?? EMOJI_BY_ID[LEGACY[value] ?? ""] ?? null;
}

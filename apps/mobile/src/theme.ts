/**
 * Design tokens — the typed source of truth for color, type, and spacing.
 * Encodes apps/mobile/DESIGN.md. Import these; never hardcode hex values.
 */

import type { Color as PlayerColor } from "@ludo/engine";

export const palette = {
  // Chrome neutrals (the table, panels, text).
  feltCharcoal: "#14171C",
  raisedSlate: "#1C2026",
  liftedSlate: "#242932",
  hairline: "rgba(255,255,255,0.08)",
  porcelain: "#F4F6F8",
  mutedSteel: "#9BA3AF",
  ivoryCell: "#ECE9DF",
} as const;

/** Functional team palette — board-only. Keyed by engine player color. */
export const teamColor: Record<PlayerColor, string> = {
  red: "#E5484D", // Vermilion
  green: "#2FA968", // Jade
  yellow: "#EFB728", // Marigold
  blue: "#3E63DD", // Cobalt
};

/** A soft, low-spread tint of a team color for fills/zones (never neon glow). */
export const teamTint: Record<PlayerColor, string> = {
  red: "rgba(229,72,77,0.16)",
  green: "rgba(47,169,104,0.16)",
  yellow: "rgba(239,183,40,0.16)",
  blue: "rgba(62,99,221,0.16)",
};

/** Readable text color to place ON a filled team color (Marigold needs dark ink). */
export function onTeamColor(color: PlayerColor): string {
  return color === "yellow" ? palette.feltCharcoal : palette.porcelain;
}

export const font = {
  display: "Outfit_700Bold",
  semibold: "Outfit_600SemiBold",
  medium: "Outfit_500Medium",
  regular: "Outfit_400Regular",
  mono: "JetBrainsMono_500Medium",
} as const;

/** 8pt spacing scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

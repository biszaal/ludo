/**
 * Which modes the server can run, and how a mode becomes rules.
 *
 * Only turn-based modes appear here. Frenzy is vs AI only: this server is built
 * around one actor per write (one state_version, one turn_deadline, a die keyed
 * on the version), and a request naming it is refused like any unknown mode.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState, RuleConfig } from "../_shared/engine/index.js";
import { serverConfig, type Json, type SupabaseClient } from "./lib.ts";

export type GameMode = "classic" | "blitz";

/** Refusal for a mode this request may not use. */
export const MODE_UNAVAILABLE = "That mode isn't available.";

/** Absent means classic: every client shipped before modes sends nothing. */
export function parseMode(raw: unknown): GameMode | null {
  if (raw === undefined || raw === null || raw === "classic") return "classic";
  return raw === "blitz" ? "blitz" : null;
}

/** Classic adds nothing: its dealt state must stay byte-identical to before. */
export function rulesForMode(mode: GameMode): Partial<RuleConfig> {
  return mode === "blitz" ? { tokensToWin: 1 } : {};
}

export function modeOfState(state: GameState): GameMode {
  return state.rules.tokensToWin === 1 ? "blitz" : "classic";
}

/** The games-row columns for a mode. Classic writes none and takes the default. */
export function modeColumns(mode: GameMode): { mode?: GameMode } {
  return mode === "classic" ? {} : { mode };
}

/** Is this mode open for new tables? Read from the server's config, never the client's. */
export async function modeOpen(admin: SupabaseClient, mode: GameMode): Promise<boolean> {
  if (mode === "classic") return true;
  const cfg = await serverConfig(admin);
  return ((cfg.modes ?? {}) as Json).blitzOnline === true;
}

/** Can the app making this request play at a table of this mode? */
export function canSit(mode: GameMode, features: unknown): boolean {
  return mode === "classic" || (Array.isArray(features) && features.includes(mode));
}

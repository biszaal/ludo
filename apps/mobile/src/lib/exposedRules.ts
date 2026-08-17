/**
 * The curated subset of engine RuleConfig flags surfaced as "house rules" when
 * starting a local game. Blockades stay hidden (off in v1), and the bonus-roll
 * flags for capture/finish stay at their defaults — exposing every flag would
 * be noise, not choice. Online games always use DEFAULT_RULES.
 */

import type { RuleConfig } from "@ludo/engine";

export interface ExposedRule {
  key: keyof RuleConfig;
  label: string;
  hint: string;
}

export const EXPOSED_RULES: ExposedRule[] = [
  { key: "leaveYardOnSix", label: "Six to leave the yard", hint: "Pawns need a 6 to enter play" },
  { key: "extraTurnOnSix", label: "Extra roll on a six", hint: "Rolling 6 grants another roll" },
  { key: "threeSixesForfeit", label: "Three sixes forfeit", hint: "Three 6s in a row ends the turn" },
  { key: "exactRollToFinish", label: "Exact roll to finish", hint: "Overshooting the center is not allowed" },
  { key: "safeSquares", label: "Safe squares", hint: "No captures on starred squares" },
  { key: "protectStacks", label: "Pairs protect", hint: "Two of your pawns on a square can't be taken" },
];

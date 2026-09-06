/**
 * May an OTA update be applied right now — the pure half of lib/updates.ts.
 *
 * Split out for the same reason lib/bonusSchedule.ts is: the module that acts
 * on this answer imports expo-updates and react-native, neither of which loads
 * in Node, and this rule is the part actually worth testing.
 *
 * It is also the part where a mistake costs a player something. Applying an
 * update means `Updates.reloadAsync()` — the app restarts, hard, with no
 * warning. Do that mid-match and the player sees a crash, their seat falls to
 * the stall bot, and on a staked table the pot goes with it. Every other
 * failure mode here is invisible: refusing a safe moment just means the update
 * lands at the next cold launch, exactly as it would have anyway.
 *
 * So the test is deliberately the strictest one available, and it is written as
 * a whitelist rather than a list of things to avoid. A new screen added later
 * is unsafe by default, which is the direction an unreviewed change should
 * fail in.
 */

/** Just enough of the nav stack to answer the question. */
export interface UpdateSafetyInput {
  /** An online game is joined or in progress (onlineStore.gameId). */
  inOnlineGame: boolean;
  /** A local pass-and-play or vs-AI game is live (gameStore.state). */
  inLocalGame: boolean;
  /** Screen names on the nav stack, root first. */
  screens: readonly string[];
}

/**
 * True only at rest on the home screen with no game of either kind alive.
 *
 * The stack-depth check is doing real work and is not redundant with the name
 * check. Sheets in this app are not nav entries, but screens pushed OVER home
 * are — settings, shop, the account flow — and a player sitting on any of them
 * may have a half-typed username or a purchase mid-flight. `["home"]` and only
 * `["home"]` means there is nothing above the hub to interrupt.
 */
export function canApplyUpdate(input: UpdateSafetyInput): boolean {
  if (input.inOnlineGame) return false;
  if (input.inLocalGame) return false;
  return input.screens.length === 1 && input.screens[0] === "home";
}

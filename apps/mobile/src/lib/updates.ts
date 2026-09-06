/**
 * Over-the-air JS updates.
 *
 * Until this existed, a bug in a shipped build was unfixable for as long as a
 * store review took — which is why so much of this game's logic lives in the
 * edge function: the server was the only half we could actually hot-fix. This
 * is the other half of that lane, and nothing more. Native changes still need
 * a real build, and `runtimeVersion: fingerprint` (app.json) is what enforces
 * that: an update is only ever offered to a binary whose native fingerprint
 * matches the one it was built against, so a JS bundle can never land on a
 * runtime that lacks a module it calls.
 *
 * WHEN AN UPDATE IS APPLIED is the whole design here.
 *
 * expo-updates already downloads on launch and swaps the bundle in at the next
 * cold start, with no help from us. That alone is correct but slow: a player
 * who never fully quits the app can sit on a broken build for days. The reload
 * below shortens that — and reloading is a hard cut, so it must never happen
 * anywhere a cut costs something. Mid-match it would read as a crash, drop the
 * player's seat to the stall bot, and on a staked table cost them the pot.
 *
 * So the rule is narrow on purpose: reload only from the home screen, with no
 * game of either kind alive. Anywhere else we leave the pending update exactly
 * where it is — the next launch applies it anyway, which is the behaviour we
 * would have had regardless. Missing a chance to reload early costs nothing;
 * taking one at the wrong moment costs a game.
 */

import { AppState, type AppStateStatus } from "react-native";
import * as Updates from "expo-updates";
import { useOnlineStore } from "../store/onlineStore";
import { useGameStore } from "../store/gameStore";
import { useNav } from "../store/navStore";
import { captureError } from "./crashReporting";
import { canApplyUpdate } from "./updateSafety";

/**
 * Least time between checks.
 *
 * Foreground events are cheap to receive and expensive to act on — a player
 * switching apps to answer a message generates a burst of them, and each check
 * is a network round trip. Ten minutes is far below any plausible release
 * cadence and far above that burst.
 */
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

let lastCheckAtMs = 0;
/** A check is already in flight; a second would race it for the same bundle. */
let checking = false;
/** Downloaded and waiting for a safe moment. Survives failed reload attempts. */
let pending = false;

/** Read the three stores and ask lib/updateSafety.ts, which holds the rule and
 *  its tests. Nothing here decides anything. */
function safeToReload(): boolean {
  return canApplyUpdate({
    inOnlineGame: useOnlineStore.getState().gameId !== null,
    inLocalGame: useGameStore.getState().state !== null,
    screens: useNav.getState().stack.map((e) => e.name),
  });
}

async function applyIfSafe(): Promise<void> {
  if (!pending || !safeToReload()) return;
  pending = false;
  try {
    await Updates.reloadAsync();
  } catch (e) {
    // The bundle is still downloaded and still applies at the next launch, so
    // a failed reload costs nothing but the shortcut. Put it back on the shelf
    // in case a later foreground finds a better moment.
    pending = true;
    captureError(e, { where: "updates.reload" });
  }
}

/**
 * Check, download, and apply if the moment allows.
 *
 * Every failure is swallowed: a player with no connectivity, an Expo endpoint
 * having a bad day, and a build with updates disabled must all behave exactly
 * like a player who is already up to date.
 */
async function checkForUpdate(): Promise<void> {
  if (checking || !Updates.isEnabled) return;
  const now = Date.now();
  if (now - lastCheckAtMs < CHECK_INTERVAL_MS) return;
  checking = true;
  lastCheckAtMs = now;
  try {
    if (!pending) {
      // Every variant of the result carries `isAvailable`, so this one test
      // also declines a roll-back-to-embedded (which reports false). Rolling a
      // player backwards is a deliberate act; it should not ride in on the
      // same automatic path as a fix.
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) return;
      // `isNew` is the fetch actually landing a bundle. Without this check a
      // failed download would arm `pending`, and the next safe moment would
      // reload the app onto exactly the build it is already running.
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return;
      pending = true;
    }
    await applyIfSafe();
  } catch (e) {
    captureError(e, { where: "updates.check" });
  } finally {
    checking = false;
  }
}

/**
 * Start watching for updates. Returns the teardown, matching every other
 * `init*` in this app so App.tsx can treat them alike.
 *
 * No-ops in development, where the packager serves the bundle and
 * `Updates.isEnabled` is false — without that guard every reload in Expo Go
 * would spend a round trip discovering it has nothing to do.
 */
export function initUpdates(): () => void {
  if (!Updates.isEnabled) return () => {};

  void checkForUpdate();

  const onChange = (next: AppStateStatus): void => {
    if (next !== "active") return;
    // Two separate jobs, and the order matters. A bundle downloaded during an
    // earlier session may already be waiting, and the player is on whatever
    // screen the foreground just landed them on — try to apply that first,
    // because it needs no network and may be ready this instant.
    void applyIfSafe();
    void checkForUpdate();
  };

  const sub = AppState.addEventListener("change", onChange);
  return () => sub.remove();
}

/**
 * Apply a waiting update now if the app is somewhere it can be interrupted.
 *
 * Called when the player lands back on home — the one transition that turns an
 * unsafe moment into a safe one without any app-state change to hang it off.
 * Without this, finishing a game and staying in the app defers the update to
 * the next cold launch, which for an engaged player may be days away.
 */
export function applyPendingUpdate(): void {
  void applyIfSafe();
}

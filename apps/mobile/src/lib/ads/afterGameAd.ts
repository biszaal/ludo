/**
 * The end-of-game interstitial, shown on Home and nowhere else.
 *
 * Owner rule (2026-11-17): the full-screen ad follows a game the player has
 * LEFT — finished or quit — and only once they are back on Home. Never on the
 * board: not when the match ends while they are still looking at it, and not
 * when they have finished and stay to watch the others race. Previously the ad
 * fired from inside the game screen (on "watch the rest" after a finish and on
 * the way out), so it covered the table.
 *
 * Leaving a game marks one ad as due. When Home is the screen on top, nothing is
 * being played or searched for and the app is in the foreground, it waits a
 * moment for the screen change to settle, checks again, and makes one attempt —
 * still subject to every pacing rule in canShowInterstitial. Starting another
 * game before that drops the due ad; the next game the player leaves marks a new
 * one.
 */

import { AppState } from "react-native";
import { useConfig } from "../../store/configStore";
import { useAds, canShowInterstitial } from "../../store/adsStore";
import { noAdsActive, useEntitlements } from "../../store/entitlementsStore";
import { useNav } from "../../store/navStore";
import { useOnlineStore } from "../../store/onlineStore";
import { showInterstitial } from "./provider";

/** Screens where a player is at a table or waiting for one. */
const PLAY_SCREENS: readonly string[] = ["lobby", "onlineGame", "localGame", "frenzyGame"];

/** Long enough for the pop back to Home to finish before a takeover lands. */
export const AFTER_GAME_SETTLE_MS = 800;

/** Online statuses during which the player is starting or playing a game. */
const BUSY_ONLINE: readonly string[] = ["connecting", "lobby", "active"];

/**
 * Is this a moment the after-game ad may appear? Pure, so the rule is testable:
 * Home is on top, no play screen anywhere on the stack, no online game being
 * joined or played, and the app is in the foreground.
 */
export function homeIsClear(view: { stack: readonly string[]; onlineStatus: string; appActive: boolean }): boolean {
  const top = view.stack[view.stack.length - 1];
  if (top !== "home") return false;
  if (view.stack.some((name) => PLAY_SCREENS.includes(name))) return false;
  if (BUSY_ONLINE.includes(view.onlineStatus)) return false;
  return view.appActive;
}

let due = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** A game was just left, finished or not. Called by GameView on every leave. */
export function markGameLeft(): void {
  due = true;
}

function currentView() {
  return {
    stack: useNav.getState().stack.map((entry) => entry.name),
    onlineStatus: useOnlineStore.getState().status,
    appActive: AppState.currentState === "active",
  };
}

/** One attempt, under every pacing rule. Exported for tests. */
export async function showAfterGameAd(): Promise<boolean> {
  const entitled = noAdsActive(useEntitlements.getState().owned, useEntitlements.getState().noAdsRestored);
  if (!canShowInterstitial(useAds.getState(), useConfig.getState().config, entitled)) return false;
  const shown = await showInterstitial();
  if (shown) useAds.getState().noteInterstitialShown();
  return shown;
}

function consider(): void {
  if (!due) return;
  if (BUSY_ONLINE.includes(useOnlineStore.getState().status)) {
    // A new game has started (or is being searched for) before the ad got its
    // moment — including during the settle delay: that ad is gone. The next
    // game left marks a new one.
    due = false;
    if (timer) clearTimeout(timer);
    timer = null;
    return;
  }
  if (timer) return;
  if (!homeIsClear(currentView())) return;
  timer = setTimeout(() => {
    timer = null;
    if (!due || !homeIsClear(currentView())) return;
    due = false;
    void showAfterGameAd();
  }, AFTER_GAME_SETTLE_MS);
}

/** Start watching. Called once from App; returns the unsubscribe. */
export function watchAfterGameAd(): () => void {
  const offNav = useNav.subscribe(() => consider());
  const offOnline = useOnlineStore.subscribe((s, prev) => {
    if (s.status !== prev.status) consider();
  });
  const appSub = AppState.addEventListener("change", (next) => {
    if (next === "active") consider();
  });
  return () => {
    offNav();
    offOnline();
    appSub.remove();
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

/** Tests start clean. Production never calls this. */
export function testingOnlyReset(): void {
  due = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

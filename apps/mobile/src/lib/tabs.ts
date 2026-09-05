/**
 * Rules for the persistent bottom dock: where it shows, which item reads as
 * active, what a dock press does to the nav stack, and how much room a screen
 * must leave so its content clears a dock that floats over it.
 *
 * Pure on purpose. ScreenStack and HomeDock render what these say rather than
 * branching themselves, so the behaviour is unit-testable without a renderer.
 */

import type { ScreenName } from "../store/navStore";

/** The four doorways the dock offers. */
export type TabName = "home" | "shop" | "friends" | "account";

const TAB_NAMES: readonly TabName[] = ["home", "shop", "friends", "account"];

/**
 * Should ScreenStack draw the dock over this screen?
 *
 * Home is deliberately false. The hub renders its own dock inside a measured
 * vertical budget; a second one from the stack would double up. Every other
 * tab gets the stack's copy, which stays mounted as those screens swap.
 *
 * How to play is not a tab — it is a leaf reached from Settings and the pause
 * menu — so it keeps its full screen.
 */
export function stackShowsDock(name: ScreenName): boolean {
  return isTab(name) && name !== "home";
}

export function activeTabFor(name: ScreenName): TabName | null {
  return isTab(name) ? name : null;
}

function isTab(name: ScreenName): name is TabName {
  return TAB_NAMES.includes(name as TabName);
}

/**
 * What tapping `target` should do to a stack currently topped by `current`.
 *
 * Doorway-to-doorway replaces instead of pushing: a persistent dock invites
 * wandering, and pushing would bury the hub under every tab you touched. The
 * stack therefore never grows past [home, tab], so Android back is always one
 * step home.
 */
export type TabNavOp =
  | { op: "push"; name: ScreenName }
  | { op: "replace"; name: ScreenName }
  | { op: "popTo"; name: ScreenName }
  | { op: "none" };

export function tabNavOp(current: ScreenName, target: ScreenName): TabNavOp {
  if (current === target) return { op: "none" };
  if (target === "home") return { op: "popTo", name: "home" };
  if (current === "home") return { op: "push", name: target };
  return { op: "replace", name: target };
}

/** Tray height at scale 1, matching the hub's natural dock. */
const DOCK_TRAY = 64;
/** Breathing room above the tray, and below it when there is no home indicator. */
const DOCK_PAD = 8;

/**
 * Room a scrolling screen must leave at the bottom so its last row is not
 * stranded under the floating dock.
 */
export function dockClearance(scale: number, bottomInset: number): number {
  return Math.round(DOCK_TRAY * scale) + DOCK_PAD + Math.max(bottomInset, DOCK_PAD);
}

/** The tray's own height, so the dock and the clearance never drift apart. */
export function dockTrayHeight(scale: number): number {
  return Math.round(DOCK_TRAY * scale);
}

export { DOCK_PAD };

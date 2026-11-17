/**
 * Our own apps, shown in a banner slot that Google left empty.
 *
 * Owner request (2026-11-18): on iOS the banner units answer "no fill" often
 * enough that Home showed a blank grey band. When that happens the slot shows
 * one of these instead. They are not ads in AdMob's sense — no request, no
 * impression, no click is reported anywhere — so a tap on one, the owner's own
 * included, can never count as invalid traffic.
 *
 * All four are App Store only, so Android has none and its empty slot collapses
 * instead (see AdSlot). Add a `play` id here when one ships on Google Play.
 *
 * Pure data (icons live in promoIcons, which needs the bundler), so the rules
 * here are testable in Node.
 */

import type { StringKey } from "../../i18n";

export interface Promo {
  id: string;
  /** The store name, short form. Not translated: it is the product's name. */
  name: string;
  /** One line under the name. */
  line: StringKey;
  /** App Store numeric id. */
  appStore?: string;
}

export const PROMOS: readonly Promo[] = [
  { id: "cascade", name: "Cascade", line: "promo.cascade", appStore: "6810394977" },
  { id: "helicopter", name: "Helicopter: Cave Edition", line: "promo.helicopter", appStore: "6786880982" },
  { id: "itrackhabit", name: "iTrackHabit", line: "promo.itrackhabit", appStore: "6751805707" },
  { id: "expenzez", name: "Expenzez", line: "promo.expenzez", appStore: "6751338089" },
];

/** The promos this platform can open. */
export function promosFor(platform: string, list: readonly Promo[] = PROMOS): Promo[] {
  return platform === "ios" ? list.filter((p) => p.appStore) : [];
}

export function promoUrl(promo: Promo): string {
  return `https://apps.apple.com/app/id${promo.appStore}`;
}

// Each slot that falls back takes the next one, so Home and matchmaking — and
// Home after every game — do not keep showing the same app. Starts at a random
// one so the first app in the list is not the only one most players ever see.
let cursor = Math.floor(Math.random() * PROMOS.length);

export function nextPromo(available: readonly Promo[]): Promo | null {
  if (available.length === 0) return null;
  const promo = available[cursor % available.length];
  cursor += 1;
  return promo;
}

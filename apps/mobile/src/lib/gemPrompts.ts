/**
 * Wording for the two gem confirmations.
 *
 * Kept out of the sheet so the copy can be pinned by tests: these are the last
 * words a player reads before being charged, or before a trade that cannot be
 * reversed. Both return a ConfirmRequest for `confirm()`.
 */

import { formatExact } from "./format";
import type { ConfirmRequest } from "../store/confirmStore";

function gemCount(n: number): string {
  return `${n} gem${n === 1 ? "" : "s"}`;
}

/**
 * `priceLabel` is the store's own localized price string and is inserted
 * verbatim — Apple charges a per-storefront price it picks itself, so the
 * figure must never be reformatted, converted, or substituted with a USD
 * amount from config. Omitted when the store hasn't given us a price (the dev
 * stub path): then the confirmation promises no number rather than a wrong
 * one, and the store's own sheet states the price before anything is charged.
 */
export function buyGemsPrompt(gems: number, priceLabel?: string): ConfirmRequest {
  return {
    title: `Buy ${gemCount(gems)}?`,
    message: priceLabel
      ? `You'll be charged ${priceLabel}.`
      : "The store will show the price before you're charged.",
    confirmLabel: "Buy",
  };
}

/**
 * Not marked destructive: trading gems for coins gives something back, and red
 * would read as a loss. The irreversibility lives in the message instead, where
 * it is stated rather than merely implied by a colour.
 */
export function exchangeGemsPrompt(gems: number, coins: number): ConfirmRequest {
  return {
    title: `Exchange ${gemCount(gems)}?`,
    message: `You'll get ${formatExact(coins)} coins. One-way — gems never come back.`,
    confirmLabel: "Exchange",
  };
}

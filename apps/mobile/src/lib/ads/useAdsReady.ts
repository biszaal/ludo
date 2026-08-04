/**
 * Ad readiness as React state.
 *
 * Kept out of provider.ts so that module stays React-free (it is imported from
 * plain functions and stores). Every UI that gates on ads must use this rather
 * than calling adsReady() directly: readiness flips asynchronously after
 * consent + SDK startup, and a bare call is read once and never revisited, so
 * the surface silently stays hidden for the rest of the session.
 */

import { useSyncExternalStore } from "react";
import { adsReady, subscribeAdsReady } from "./provider";

export function useAdsReady(): boolean {
  return useSyncExternalStore(subscribeAdsReady, adsReady, adsReady);
}

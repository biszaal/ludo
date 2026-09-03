/**
 * Crash and error reporting.
 *
 * Until now a crash in a shipped build was invisible: the app has real-money
 * purchases and the only channel for "it broke" was a store review, written by
 * someone who had already uninstalled. This is the difference between finding
 * out about a bad release from telemetry and finding out from a one-star.
 *
 * OPTIONAL BY CONSTRUCTION, exactly like lib/supabase.ts. With no DSN
 * configured this is a no-op and the app behaves as it always has — a checkout
 * without secrets still builds and runs, and a reporting backend that is down or
 * unconfigured must never be a reason a player cannot play.
 *
 * What is deliberately NOT sent: no `sendDefaultPii`, so no IP address and no
 * device identifiers beyond what a stack trace carries. The user id attached
 * below is the anonymous auth id, which is already the only name this game knows
 * anyone by — it is what makes "did this crash hit one player or a hundred"
 * answerable, and it identifies nobody outside this database.
 */

import * as Sentry from "@sentry/react-native";
import { APP_VERSION } from "./appVersion";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

/** True when a DSN is configured; false makes every function here a no-op. */
export const isCrashReportingConfigured = Boolean(dsn);

let started = false;

/** Start reporting. Safe to call more than once; safe to call with no DSN. */
export function initCrashReporting(): void {
  if (started || !isCrashReportingConfigured) return;
  started = true;
  try {
    Sentry.init({
      dsn,
      // The version a report came from is the first question every crash raises.
      release: APP_VERSION,
      // Off deliberately — see the header. Stack traces, not people.
      sendDefaultPii: false,
      // A game loop produces a lot of breadcrumbs; the last 50 are the ones that
      // explain a crash, and more than that is mostly noise to page through.
      maxBreadcrumbs: 50,
      // Errors only. Performance tracing on a 60fps Skia board would sample the
      // hot path we spent this project making fast.
      tracesSampleRate: 0,
    });
  } catch {
    // A reporting SDK that cannot start is not a reason to fail a launch.
    started = false;
  }
}

/**
 * Tell reports which player they came from — the anonymous auth id, nothing
 * more. Called when identity settles and again whenever it changes, because a
 * crash attributed to the previous account is worse than one attributed to
 * nobody.
 */
export function setCrashUser(userId: string | null): void {
  if (!isCrashReportingConfigured) return;
  try {
    Sentry.setUser(userId ? { id: userId } : null);
  } catch {
    // ignore
  }
}

/**
 * Report something that was handled but should not have happened.
 *
 * For the caught-and-recovered cases that would otherwise leave no trace: a
 * failed link, a rejected turn the client papered over. These are the bugs that
 * never crash and never get reported.
 */
export function reportHandled(error: unknown, context?: Record<string, unknown>): void {
  if (!isCrashReportingConfigured) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // ignore
  }
}

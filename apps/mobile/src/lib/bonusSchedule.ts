/**
 * When the daily-bonus reminder should fire — the pure half of
 * lib/bonusReminder.ts.
 *
 * Split out for the same reason lib/moveTiming.ts is: the scheduling module
 * imports expo-notifications, which cannot load in Node, and this is the part
 * actually worth testing. It straddles two clocks — the bonus resets at UTC
 * midnight (daily_bonus_claim, 0039) while the person being woken up lives in
 * local time — and getting that wrong fails quietly, by pinging people at four
 * in the morning rather than by throwing.
 *
 * Both functions take the clock as an argument. Nothing here reads Date.now().
 */

/** Civil hours to deliver in, local time. A notification at 3am is not a
 *  reminder, it is a reason to turn notifications off. */
const EARLIEST_HOUR = 9;
const LATEST_HOUR = 21;
/** Where a reminder gets pushed to when the reset lands outside those hours. */
const CATCHUP_HOUR = 10;

/**
 * When to fire, given "now" and when the bonus next becomes claimable.
 *
 * Pure and clock-injected so the timezone matrix is testable — this is the part
 * that is easy to get subtly wrong, because the reset is in UTC and the person
 * being woken up is not.
 *
 * `resetAt` is the moment the bonus unlocks; the reminder never fires before
 * it (a "your bonus is ready" that isn't would be a lie, and the tap would
 * land on a claimed-out sheet). From there it moves forward to the next civil
 * hour, which for most timezones is the same day and for the rest is the
 * following morning.
 */
export function reminderTime(now: Date, resetAt: Date): Date {
  const at = new Date(Math.max(resetAt.getTime(), now.getTime() + 60_000));
  const hour = at.getHours();
  if (hour >= EARLIEST_HOUR && hour < LATEST_HOUR) return at;

  // Outside waking hours: hold it to the next catch-up slot. Late evening rolls
  // to tomorrow morning; the small hours stay on the same calendar day.
  const slot = new Date(at);
  slot.setHours(CATCHUP_HOUR, 0, 0, 0);
  if (slot.getTime() <= at.getTime()) slot.setDate(slot.getDate() + 1);
  return slot;
}

/** The next UTC midnight after `now` — when `last_bonus_on` stops matching
 *  today and the claim opens again. */
export function nextResetAfter(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/**
 * The one pending local reminder. Stable on purpose: rescheduling cancels
 * this id and writes it again, so a claim cannot leave yesterday's ping
 * queued behind today's.
 */
export const CHEST_REMINDER_ID = "daily-bonus-reminder";

export interface ReminderFacts {
  /** The settings toggle. Off means the pending one must come down. */
  remindersOn: boolean;
  /** OS permission already granted. This path never asks. */
  granted: boolean;
  /** Server says a chest is sitting unclaimed right now. */
  claimable: boolean;
  now: Date;
}

export interface ReminderPlan {
  /** Always cancelled first, whether or not a new one is armed. */
  cancelId: string;
  /** Null when nothing should be armed (off, or not permitted). */
  schedule: { id: string; at: Date } | null;
}

/** The two OS calls a plan needs. Tests pass a fake; the app passes expo-notifications. */
export interface ReminderSink {
  cancel(id: string): Promise<void>;
  schedule(id: string, at: Date): Promise<void>;
}

/**
 * What to do with the pending "daily chest is ready" reminder.
 *
 * Pure aside from {@link ChestReminder.apply}, which only walks a plan into a
 * sink. The clock comes in as `now` — nothing here reads `Date.now()` — and the
 * unlock time is {@link nextResetAfter}, the same UTC-midnight boundary the
 * server uses (`daily_bonus_claim`), not a hard-coded 24h.
 */
export class ChestReminder {
  static plan(facts: ReminderFacts): ReminderPlan {
    if (!facts.remindersOn || !facts.granted) {
      return { cancelId: CHEST_REMINDER_ID, schedule: null };
    }
    // Already claimable: remind about THIS chest. Otherwise the next UTC reset,
    // which is when a claim just made opens again.
    const unlocks = facts.claimable ? facts.now : nextResetAfter(facts.now);
    return {
      cancelId: CHEST_REMINDER_ID,
      schedule: { id: CHEST_REMINDER_ID, at: reminderTime(facts.now, unlocks) },
    };
  }

  /** Cancel the stale reminder, then arm the new one under the same id. */
  static async apply(plan: ReminderPlan, sink: ReminderSink): Promise<void> {
    await sink.cancel(plan.cancelId);
    if (plan.schedule) await sink.schedule(plan.schedule.id, plan.schedule.at);
  }
}

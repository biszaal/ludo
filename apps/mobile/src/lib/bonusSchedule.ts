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

/**
 * The daily-bonus reminder's scheduling math.
 *
 * Worth testing on its own because it straddles two clocks: the bonus resets at
 * UTC midnight (daily_bonus_claim, 0039) and the person being woken up lives in
 * local time. Getting that wrong doesn't fail loudly — it just pings people at
 * four in the morning, or fires before the bonus actually exists and lands them
 * on a sheet that says "come back tomorrow".
 *
 * This covers lib/bonusSchedule.ts, the pure half. The other half is an
 * expo-notifications call and a permission check; there is nothing there to
 * assert that isn't asserting the mock.
 */

import { describe, it, expect } from "vitest";
import { ChestReminder, nextResetAfter, reminderTime, type ReminderSink } from "../src/lib/bonusSchedule";

/** Local-time hour of a Date, which is what the player experiences. */
const hourOf = (d: Date) => d.getHours();

describe("nextResetAfter", () => {
  it("lands on the next UTC midnight", () => {
    const next = nextResetAfter(new Date(Date.UTC(2026, 7, 20, 13, 45, 30)));
    expect(next.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("moves to the following day when already at midnight UTC", () => {
    // Exactly at the boundary the CURRENT day's bonus is the one just unlocked,
    // so "next" has to mean tomorrow or the reminder would fire immediately.
    const next = nextResetAfter(new Date(Date.UTC(2026, 7, 20, 0, 0, 0)));
    expect(next.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("is always in the future", () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 7, 20, h, 30));
      expect(nextResetAfter(now).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("reminderTime", () => {
  const now = new Date(Date.UTC(2026, 7, 20, 12, 0));

  it("never fires before the bonus actually exists", () => {
    // Every reset hour, all year: a reminder for a bonus that has not unlocked
    // yet would send the player to a sheet with nothing in it.
    for (let day = 0; day < 365; day += 7) {
      for (let h = 0; h < 24; h++) {
        const base = new Date(Date.UTC(2026, 0, 1 + day, h, 0));
        const reset = nextResetAfter(base);
        expect(reminderTime(base, reset).getTime()).toBeGreaterThanOrEqual(reset.getTime());
      }
    }
  });

  it("never fires in the past", () => {
    // A reset that already happened (the bonus is sitting there unclaimed) must
    // still schedule forward — the OS silently drops a date-trigger in the past.
    const stale = new Date(now.getTime() - 6 * 3600_000);
    expect(reminderTime(now, stale).getTime()).toBeGreaterThan(now.getTime());
  });

  it("only ever lands in civil hours", () => {
    for (let day = 0; day < 365; day += 3) {
      for (let h = 0; h < 24; h++) {
        const base = new Date(Date.UTC(2026, 0, 1 + day, h, 0));
        const at = reminderTime(base, nextResetAfter(base));
        expect(hourOf(at)).toBeGreaterThanOrEqual(9);
        expect(hourOf(at)).toBeLessThan(22);
      }
    }
  });

  it("holds a small-hours reset until later the same morning", () => {
    // 03:00 local — pushed to the 10:00 catch-up slot, not to the next day.
    const at3am = new Date(2026, 7, 21, 3, 0);
    const out = reminderTime(new Date(2026, 7, 20, 23, 0), at3am);
    expect(hourOf(out)).toBe(10);
    expect(out.getDate()).toBe(21);
  });

  it("rolls a late-evening reset to the next morning", () => {
    const at11pm = new Date(2026, 7, 20, 23, 0);
    const out = reminderTime(new Date(2026, 7, 20, 22, 0), at11pm);
    expect(hourOf(out)).toBe(10);
    expect(out.getDate()).toBe(21);
  });

  it("uses the reset moment itself when it already falls in civil hours", () => {
    const atNoon = new Date(2026, 7, 21, 12, 0);
    expect(reminderTime(new Date(2026, 7, 20, 12, 0), atNoon).getTime()).toBe(atNoon.getTime());
  });
});

function recordingSink(): { sink: ReminderSink; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sink: {
      cancel: async (id) => {
        calls.push(`cancel:${id}`);
      },
      schedule: async (id, at) => {
        calls.push(`schedule:${id}:${at.toISOString()}`);
      },
    },
  };
}

describe("ChestReminder", () => {
  const now = new Date(Date.UTC(2026, 7, 20, 15, 0, 0));

  it("with no recorded play, aims a fresh claim at the next reset", () => {
    const plan = ChestReminder.plan({ remindersOn: true, granted: true, claimable: false, now, lastPlayAt: null });
    expect(plan.schedule?.at.getTime()).toBe(reminderTime(now, nextResetAfter(now)).getTime());
    expect(plan.schedule?.id).toBe(plan.cancelId);
  });

  it("aims at 24 hours after the last claim or win, the time of day they play", () => {
    const playedAt = new Date(now.getTime() - 2 * 3_600_000);
    const plan = ChestReminder.plan({ remindersOn: true, granted: true, claimable: false, now, lastPlayAt: playedAt });
    const dayLater = new Date(playedAt.getTime() + 24 * 3_600_000);
    expect(plan.schedule?.at.getTime()).toBe(reminderTime(now, dayLater).getTime());
  });

  it("never aims before the chest unlocks: an old last play falls back to the next reset", () => {
    const playedAt = new Date(now.getTime() - 30 * 3_600_000);
    const plan = ChestReminder.plan({ remindersOn: true, granted: true, claimable: false, now, lastPlayAt: playedAt });
    expect(plan.schedule?.at.getTime()).toBe(reminderTime(now, nextResetAfter(now)).getTime());
  });

  it("aims an unclaimed chest at today, still through the same clock", () => {
    const plan = ChestReminder.plan({ remindersOn: true, granted: true, claimable: true, now });
    expect(plan.schedule?.at.getTime()).toBe(reminderTime(now, now).getTime());
  });

  it("cancels the pending reminder and does not arm another when permission is missing", async () => {
    const { sink, calls } = recordingSink();
    const plan = ChestReminder.plan({ remindersOn: true, granted: false, claimable: false, now });
    expect(plan.schedule).toBeNull();
    await ChestReminder.apply(plan, sink);
    expect(calls).toEqual([`cancel:${plan.cancelId}`]);
  });

  it("cancels and does not reschedule when reminders are switched off", async () => {
    const { sink, calls } = recordingSink();
    const plan = ChestReminder.plan({ remindersOn: false, granted: true, claimable: false, now });
    await ChestReminder.apply(plan, sink);
    expect(calls).toEqual([`cancel:${plan.cancelId}`]);
  });

  it("replaces the previous reminder instead of stacking a second one", async () => {
    const { sink, calls } = recordingSink();
    const first = ChestReminder.plan({ remindersOn: true, granted: true, claimable: false, now });
    await ChestReminder.apply(first, sink);
    const later = new Date(now.getTime() + 60_000);
    const second = ChestReminder.plan({ remindersOn: true, granted: true, claimable: true, now: later });
    await ChestReminder.apply(second, sink);

    expect(calls.map((c) => c.split(":")[0])).toEqual(["cancel", "schedule", "cancel", "schedule"]);
    const ids = calls.map((c) => c.split(":")[1]);
    expect(new Set(ids)).toEqual(new Set([first.cancelId]));
    expect(first.cancelId).toBe("daily-bonus-reminder");
  });
});

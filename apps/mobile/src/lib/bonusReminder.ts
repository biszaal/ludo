/**
 * "Your daily chest is ready" — a LOCAL scheduled notification, not a push.
 *
 * The chest is the daily bonus. The copy says chest because that is the
 * object on the home screen; the clock is still the bonus's.
 *
 * The reminder is worth more to the player than to us, and it is entirely
 * predictable: the bonus resets at UTC midnight (daily_bonus_claim in 0039
 * compares against `(now() at time zone 'utc')::date`), so the device knows
 * when the next one lands without asking anybody. Pushing it instead would mean
 * a server cron fanning out to every install every day to say something each
 * install could work out for itself — and it would go silent the moment the
 * player was offline or the token had rotted.
 *
 * Streaks are the reason this exists at all. The bonus escalates with
 * consecutive days and resets to day one on a miss (0033), so a player who
 * forgets for one day loses a week of build-up. A reminder that fires on time
 * is the difference between a streak mechanic and a trap.
 *
 * Everything here is best-effort and silent on failure. A missing reminder is a
 * missing courtesy; it must never surface as an error over a game.
 */

import { Platform } from "react-native";
import { notifications } from "./notifications";
import { useSettings } from "../store/settingsStore";
import { useWallet } from "../store/walletStore";
import { useDailyBonus } from "../store/dailyBonusStore";
import { useStats } from "../store/statsStore";
import { PushPrompt } from "./pushPrompt";
import { CHEST_REMINDER_ID, ChestReminder } from "./bonusSchedule";
import { t } from "../i18n";

/** Android channel for reminders. Separate from "default" (invites) so the
 *  player can silence a nudge about coins without silencing a friend asking
 *  them to play — Android channel settings are per-channel and permanent once
 *  created, which is exactly why the two must not share one. */
const CHANNEL_ID = "daily-bonus";

/** Copy that says what is waiting, and leans on the streak when there is one
 *  to lose. Day 1 has nothing at stake yet, so it doesn't pretend otherwise. */
function body(streakDay: number): string {
  if (streakDay >= 2) return `Day ${streakDay + 1} of your streak is waiting. Miss a day and it starts over.`;
  return t("notify.bonusBody");
}

function lastPlayed(): Date | null {
  const at = useDailyBonus.getState().lastPlayAt;
  return at === null ? null : new Date(at);
}

/**
 * Re-point the reminder at the next unclaimed bonus.
 *
 * `claimable` is the server's answer for right now (wallets.bonusClaimable). If
 * the bonus is already sitting there unclaimed, the reminder is for TODAY —
 * nudging about tomorrow's while today's goes stale would be the wrong nudge.
 * Otherwise it is for the next UTC reset.
 *
 * Safe and cheap to call often; every call replaces the single pending
 * reminder, so the schedule converges on the truth rather than accumulating.
 */
export async function scheduleBonusReminder(claimable: boolean, streakDay: number): Promise<void> {
  const N = notifications();
  if (!N) return; // no notification module on this runtime — see lib/notifications
  try {
    // Local notifications need the same permission push does, but must never
    // PROMPT for it: this runs off a wallet refresh, with no visible cause. It
    // rides on a grant the player already gave somewhere it made sense. A
    // failed read is treated as "not granted" so the pending reminder still
    // comes down — leaving a stale one armed is the worse failure.
    let granted = false;
    try {
      granted = (await N.getPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    const plan = ChestReminder.plan({
      remindersOn: useSettings.getState().bonusRemindersOn,
      granted,
      claimable,
      now: new Date(),
      lastPlayAt: lastPlayed(),
    });

    if (plan.schedule && Platform.OS === "android") {
      await N.setNotificationChannelAsync(CHANNEL_ID, {
        name: t("home.dailyBonus"),
        importance: N.AndroidImportance.DEFAULT,
      });
    }

    await ChestReminder.apply(plan, {
      // A missing id is the steady state, not an error. Swallowing it here
      // keeps a failed cancel from skipping the schedule that replaces it.
      cancel: (id) => N.cancelScheduledNotificationAsync(id).catch(() => {}),
      schedule: async (id, at) => {
        await N.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: t("notify.bonusTitle"),
            body: body(streakDay),
            data: { type: "daily-bonus" },
          },
          trigger: {
            type: N.SchedulableTriggerInputTypes.DATE,
            date: at,
            channelId: CHANNEL_ID,
          },
        });
      },
    });
  } catch {
    // No permission yet, no notification support, or the OS refused the slot.
  }
}

/**
 * Keep the reminder pointed at the truth, by watching the wallet.
 *
 * The wallet store is the only thing that knows both halves — whether a bonus
 * is sitting unclaimed, and how long the streak is — and it is refreshed on
 * launch, on every foreground and after every claim. Subscribing here rather
 * than calling out from inside the store keeps the store what it is: plain
 * logic with no platform imports, testable in Node (see vitest.config.ts).
 *
 * The schedule therefore self-heals. A missed day, a timezone change, a claim
 * made on another device — each shows up as a wallet read, and the reminder
 * moves to match.
 *
 * Call once from App; returns an unsubscribe.
 */
export function initBonusReminder(): () => void {
  let last = "";
  let wasClaimable: boolean | null = null;
  const apply = (s: { balance: number | null; bonusClaimable: boolean; streakDay: number }) => {
    // Before the first successful read the store holds defaults, not facts, and
    // scheduling off those would arm a reminder for a bonus we know nothing
    // about. `balance` is null until a read lands, which is the signal.
    if (s.balance === null) return;
    // A chest that was waiting and now isn't was just claimed (here or on
    // another device): that is "played", and the reminder aims a day after it.
    if (wasClaimable === true && !s.bonusClaimable) useDailyBonus.getState().notePlayed(Date.now());
    wasClaimable = s.bonusClaimable;
    const key = `${s.bonusClaimable}:${s.streakDay}:${useDailyBonus.getState().lastPlayAt}`;
    if (key === last) return; // ordinary refreshes that changed nothing else
    last = key;
    void scheduleBonusReminder(s.bonusClaimable, s.streakDay);
  };
  apply(useWallet.getState());
  const stopWallet = useWallet.subscribe(apply);

  // A win is "played" too: a new player's first reminder lands a day after
  // their first win. Armed only once the stats store has rehydrated, so the
  // empty -> persisted jump on launch is not mistaken for a win.
  let stopStats: () => void = () => {};
  const arm = () => {
    stopStats = useStats.subscribe((st, prev) => {
      if (PushPrompt.countWins(st.totals) > PushPrompt.countWins(prev.totals)) {
        useDailyBonus.getState().notePlayed(Date.now());
        apply(useWallet.getState());
      }
    });
  };
  let stopHydration: (() => void) | null = null;
  if (useStats.persist.hasHydrated()) arm();
  else stopHydration = useStats.persist.onFinishHydration(() => arm());

  return () => {
    stopHydration?.();
    stopStats();
    stopWallet();
  };
}

/** Drop the pending reminder (the player turned reminders off). */
export async function cancelBonusReminder(): Promise<void> {
  const N = notifications();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(CHEST_REMINDER_ID);
  } catch {
    // Nothing scheduled, which is the state we wanted anyway.
  }
}

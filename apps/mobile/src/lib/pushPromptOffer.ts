/**
 * Shows the soft notification ask and, on a yes, hands off to the existing
 * registration path.
 *
 * The rules are {@link PushPrompt}. This file is the part that touches the OS,
 * the confirm sheet, and the stores — kept apart so the rules stay runnable
 * in Node, the same split as namePrompt / bonusSchedule.
 *
 * A "yes" calls `registerForPush`, which is what raises the OS dialog. This
 * file never calls `requestPermissionsAsync` itself. A "no" (including the
 * backdrop and Android back, which the confirm sheet already treats as no)
 * starts the cooldown. If they say yes and the OS still isn't granted, the
 * cooldown starts too: otherwise Android, which will ask again, would put
 * our sheet back up on tomorrow's chest.
 */

import { confirm, useConfirm } from "../store/confirmStore";
import { useNav } from "../store/navStore";
import { usePushPrompt } from "../store/pushPromptStore";
import { useSettings } from "../store/settingsStore";
import { useStats } from "../store/statsStore";
import { useWallet } from "../store/walletStore";
import { t } from "../i18n";
import { scheduleBonusReminder } from "./bonusReminder";
import { notifications } from "./notifications";
import { registerForPush } from "./push";
import { PushPrompt, type Delight } from "./pushPrompt";

type Outcome = "shown" | "ineligible" | "skipped";

/** Set on the 0 → 1 personal-win edge. Shown once the celebration is over,
 *  or on the next arrival at Home if they left before the match ended. */
let pendingWin = false;
let offering = false;

async function readPermission(): Promise<{ granted: boolean; canAskAgain: boolean } | null> {
  const N = notifications();
  if (!N) return null;
  try {
    const existing = await N.getPermissionsAsync();
    return { granted: existing.granted, canAskAgain: existing.canAskAgain };
  } catch {
    return null;
  }
}

export class PushPromptOffer {
  /**
   * Watch for the first personal win, and for the player arriving Home with
   * that win still unasked. Call once from App; returns an unsubscribe.
   *
   * Armed only after the stats store has rehydrated. Subscribing earlier would
   * treat the empty → persisted jump as a win, and a player who already has
   * one would be asked on every cold start.
   */
  static watch(): () => void {
    let stopStats: () => void = () => {};
    const arm = () => {
      stopStats = useStats.subscribe((s, prev) => {
        const before = PushPrompt.countWins(prev.totals);
        const after = PushPrompt.countWins(s.totals);
        if (before === 0 && after === 1) pendingWin = true;
      });
    };

    const stopNav = useNav.subscribe((s) => {
      const top = s.stack[s.stack.length - 1]?.name;
      // Home, not the table. A 4-player winner who leaves while the match
      // continues never crosses "match finished" inside the game view, and
      // the ask must not land on top of a game still being played.
      if (top === "home") void PushPromptOffer.presentPendingWin();
    });

    let stopHydration: (() => void) | null = null;
    if (useStats.persist.hasHydrated()) arm();
    else stopHydration = useStats.persist.onFinishHydration(() => arm());

    return () => {
      stopHydration?.();
      stopStats();
      stopNav();
    };
  }

  /** The celebration has been seen and the match is over. True when the
   *  sheet was shown, so the caller asks for nothing else this time. */
  static presentPendingWin(): Promise<boolean> {
    return PushPromptOffer.consumeWin("first-win");
  }

  /** A daily chest was just claimed. That is the other delight, and it wins
   *  if it happens before the first win has been asked about. */
  static onClaim(): Promise<void> {
    const winsBefore = PushPrompt.countWins(useStats.getState().totals);
    return PushPromptOffer.finish(PushPromptOffer.offer("claim", winsBefore));
  }

  private static async consumeWin(delight: Delight): Promise<boolean> {
    if (!pendingWin) return false;
    const outcome = await PushPromptOffer.offer(delight, 0);
    if (outcome !== "skipped") pendingWin = false;
    return outcome === "shown";
  }

  private static async finish(pending: Promise<Outcome>): Promise<void> {
    const outcome = await pending;
    if (outcome !== "skipped") pendingWin = false;
  }

  private static async offer(delight: Delight, winsBefore: number): Promise<Outcome> {
    if (offering) return "skipped";
    // confirm() answers an open prompt with "no" when a second one arrives.
    // Never steal a "leave the match?" out from under a tap.
    if (useConfirm.getState().request) return "skipped";
    offering = true;
    try {
      const permission = await readPermission();
      const declinedAt = usePushPrompt.getState().declinedAt;
      const signals = {
        delight,
        winsBefore,
        permissionKnown: permission !== null,
        granted: permission?.granted ?? false,
        canAskAgain: permission?.canAskAgain ?? false,
        pushOn: useSettings.getState().pushOn,
        remindersOn: useSettings.getState().bonusRemindersOn,
        declinedAt,
        now: Date.now(),
      };
      if (!PushPrompt.shouldOffer(signals)) return "ineligible";

      const yes = await confirm({
        title: t("notify.promptTitle"),
        message: t("notify.promptBody"),
        confirmLabel: t("notify.promptYes"),
        cancelLabel: t("notify.promptNo"),
      });
      if (!yes) {
        usePushPrompt.getState().decline(Date.now());
        return "shown";
      }

      // The OS dialog. registerForPush is the only asker; on a simulator it
      // returns before prompting, which is its existing rule.
      await registerForPush();
      const wallet = useWallet.getState();
      await scheduleBonusReminder(wallet.bonusClaimable, wallet.streakDay);
      const after = await readPermission();
      if (!after?.granted) usePushPrompt.getState().decline(Date.now());
      return "shown";
    } catch {
      // A failed ask must not start the cooldown — they never answered.
      return "skipped";
    } finally {
      offering = false;
    }
  }
}

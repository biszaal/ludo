/**
 * The live wiring for lib/savePrompt.ts: stores on one side, a sheet on the
 * other.
 *
 * Split the same way lib/identity.ts and lib/identityClient.ts are — the rule
 * about WHEN to ask is pure and pinned in Node, and this half is the part that
 * has to read four stores and touch React.
 *
 * `isGuest` is asked of Supabase rather than inferred from the stores, because
 * it is the one input that decides whether to interrupt at all and the stores
 * cannot answer it: a linked account and a guest have identical wallets.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getIdentity } from "./auth";
import { savePromptReason, type SavePromptReason } from "./savePrompt";
import { useProfile } from "../store/profileStore";
import { useStats } from "../store/statsStore";
import { useWallet } from "../store/walletStore";

/**
 * Ask once, on demand — never on a timer and never on every render.
 *
 * Returns the reason to show a prompt, or null. `dismiss` records that the
 * player was asked, which is what spends one of the three the policy allows;
 * the caller must call it whether they linked or declined, because either way
 * the question has been put to them.
 */
export function useSavePrompt(): {
  reason: SavePromptReason | null;
  check: () => void;
  dismiss: () => void;
} {
  const [reason, setReason] = useState<SavePromptReason | null>(null);
  // A check is a round trip to Supabase for the session; two of them racing
  // would be two prompts for one moment.
  const checking = useRef(false);

  const check = useCallback(() => {
    if (checking.current || reason !== null) return;
    checking.current = true;
    void (async () => {
      try {
        const { isGuest } = await getIdentity();
        const wallet = useWallet.getState();
        const profile = useProfile.getState();
        const totals = useStats.getState().totals;
        setReason(
          savePromptReason({
            isGuest,
            purchasedBalance: wallet.purchasedBalance,
            gems: wallet.gems ?? 0,
            coins: wallet.balance ?? 0,
            gamesPlayed: totals.ai.played + totals.pass.played + totals.online.played,
            lastAskedAt: profile.savePromptAt,
            timesAsked: profile.savePromptCount,
            now: Date.now(),
          }),
        );
      } catch {
        // No session, or offline. Staying quiet is the right failure: the cost
        // is one missed prompt, and the Home banner is still there.
      } finally {
        checking.current = false;
      }
    })();
  }, [reason]);

  const dismiss = useCallback(() => {
    // Spent whether they linked or declined — the question was asked either way,
    // and a player who has just linked is no longer a guest so the policy will
    // never return a reason for them again regardless.
    useProfile.getState().markSavePromptShown(Date.now());
    setReason(null);
  }, []);

  // Never leave a prompt pending across an unmount.
  useEffect(() => () => setReason(null), []);

  return { reason, check, dismiss };
}

/**
 * The live wiring for the welcome intro's rule (lib/firstGame.ts): the phone's
 * stats and the account's online record on one side, the intro on the other.
 *
 * The account's record is read once per Home mount, and only while the intro
 * is still undecided. A failed read leaves it unknown, which waits: the intro
 * is never shown over a regular's Home because the network blinked.
 */

import { useCallback, useEffect, useState } from "react";
import { welcomeIntro } from "./firstGame";
import { ensureSignedIn, getOnlineGamesPlayed } from "../net/api";
import { useLaunch } from "../store/launchStore";
import { useProfile } from "../store/profileStore";
import { useStats, useStatsLoaded } from "../store/statsStore";

export function useWelcomeIntro(): { show: boolean; done: () => void } {
  const seen = useProfile((s) => s.introSeen);
  const nameDone = useProfile((s) => s.namePromptSeen);
  const launched = useLaunch((s) => s.launched);
  const statsLoaded = useStatsLoaded();
  const totals = useStats((s) => s.totals);
  const localPlayed = statsLoaded ? totals.ai.played + totals.pass.played + totals.online.played : null;
  const [onlinePlayed, setOnlinePlayed] = useState<number | null>(null);
  // Once open it stays open until the player leaves it: a signal that lands
  // late must not snatch the intro away mid-card.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (seen) return;
    let alive = true;
    void (async () => {
      try {
        const userId = await ensureSignedIn();
        const played = await getOnlineGamesPlayed(userId);
        if (alive) setOnlinePlayed(played);
      } catch {
        // No session (offline first launch): unknown, so the intro waits.
      }
    })();
    return () => {
      alive = false;
    };
  }, [seen]);

  const decision = welcomeIntro({ seen, nameDone, localPlayed, onlinePlayed });

  useEffect(() => {
    // Retire it for good, so a later sign-out (a fresh guest on this phone)
    // does not greet a regular with a welcome screen.
    if (decision === "never" && !seen && !open) useProfile.getState().markIntroSeen();
    if (decision === "show" && launched) setOpen(true);
  }, [decision, seen, open, launched]);

  const done = useCallback(() => {
    useProfile.getState().markIntroSeen();
    setOpen(false);
  }, []);

  return { show: open, done };
}

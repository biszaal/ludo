/**
 * The live wiring for lib/namePrompt.ts: the session on one side, the
 * first-run name overlay on the other.
 *
 * Split the same way savePrompt.ts/useSavePrompt.ts is — the rule about whether
 * to ask is pure and pinned in Node, and this half is the part that has to read
 * an auth session and touch React.
 *
 * Who the player is has to be settled BEFORE the question is put, which means
 * `ensureSignedIn` and not a bare session read. After a reinstall AsyncStorage
 * is empty and `auth.getSession()` answers "nobody" — the account only comes
 * back once ensureSignedIn has traded the keychain's stashed refresh token for
 * a session (lib/identity). Asking first is asking the one player who already
 * has a name.
 */

import { useEffect, useState } from "react";
import { getIdentity } from "./auth";
import { askForName } from "./namePrompt";
import { ensureSignedIn } from "../net/api";
import { useProfile } from "../store/profileStore";

/** Should ChooseNameScreen be on screen right now? */
export function useNamePrompt(): boolean {
  const promptSeen = useProfile((s) => s.namePromptSeen);
  const [isGuest, setIsGuest] = useState<boolean | null>(null);

  useEffect(() => {
    if (promptSeen) return;
    let alive = true;
    void (async () => {
      try {
        await ensureSignedIn();
        const { isGuest: guest } = await getIdentity();
        if (!alive) return;
        // Retire the question for good rather than merely hiding it. Without
        // this, signing out later — which mints a new guest on this device —
        // would drop the onboarding screen on top of the hub of somebody who
        // has been playing for months.
        if (!guest) useProfile.getState().markNamePromptSeen();
        setIsGuest(guest);
      } catch {
        // No session to be had: offline on a first launch, or Supabase
        // unconfigured. Ask — that is what this device did before any of this
        // existed, and the screen is skippable.
        if (alive) setIsGuest(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [promptSeen]);

  return askForName({ promptSeen, isGuest });
}

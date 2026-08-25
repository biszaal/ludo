/**
 * A thin strip that says what the link is doing, and — when this seat has an
 * action out that nobody has answered — that the turn is at risk.
 *
 * Not a spinner. The precedent is QuickMatchSearch: a wait should have a
 * visible shape rather than a dial counting nothing. This strip states a fact
 * and then gets out of the way, which is why it renders nothing at all on a
 * healthy link — the common case must stay silent or the player learns to look
 * past it, and then it is worth nothing on the day it matters.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut } from "react-native-reanimated";
import { useConnection } from "../store/connectionStore";
import { useOnlineStore } from "../store/onlineStore";
import { font, palette, radius, space, teamColor } from "../theme";

/**
 * How long an unanswered action may sit before the strip mentions it.
 *
 * Comfortably past a normal round trip (a congested link routinely takes a
 * couple of seconds) and comfortably inside the 30s turn clock, so the warning
 * lands while the player can still do something about it rather than as an
 * epitaph for a turn the stall bot has already taken.
 */
const AT_RISK_AFTER_MS = 5000;

/** How long a rejection stays on screen before it dismisses itself. */
const ERROR_DWELL_MS = 4000;

interface Note {
  text: string;
  tone: "warn" | "bad";
}

function useAtRisk(): boolean {
  const inFlight = useOnlineStore((s) => s.actionInFlight);
  const [atRisk, setAtRisk] = useState(false);

  useEffect(() => {
    if (!inFlight) {
      setAtRisk(false);
      return;
    }
    const t = setTimeout(() => setAtRisk(true), AT_RISK_AFTER_MS);
    return () => clearTimeout(t);
  }, [inFlight]);

  return atRisk;
}

interface ConnectionStripProps {
  /** Set false where the screen already renders `error` itself (the lobby does,
   *  inline under its buttons) so a rejection is not stated twice. */
  showErrors?: boolean;
}

export function ConnectionStrip({ showErrors = true }: ConnectionStripProps = {}) {
  const link = useConnection((s) => s.link);
  const error = useOnlineStore((s) => s.error);
  const clearError = useOnlineStore((s) => s.clearError);
  const atRisk = useAtRisk();

  // Show a rejection, then let it go. This is the only place in the game screen
  // that renders `error` at all: it was being set by onActionFailed and read by
  // nobody, so "Not your turn" or "Illegal move" happened in silence.
  useEffect(() => {
    if (!error || !showErrors) return;
    const t = setTimeout(clearError, ERROR_DWELL_MS);
    return () => clearTimeout(t);
  }, [error, clearError, showErrors]);

  let note: Note | null = null;
  if (error && showErrors) {
    // Above the link states: the server has spoken, and what it said explains
    // the board better than anything we could infer about the connection.
    note = { text: error, tone: "bad" };
  } else if (link === "offline") {
    // The honest word. The app cannot send the turn, and saying "reconnecting"
    // would imply something is being attempted that is not.
    note = { text: "You're offline — waiting for a connection", tone: "bad" };
  } else if (atRisk) {
    // Online but unanswered: the request is out there and the clock is running.
    note = { text: "Still sending — your turn may time out", tone: "warn" };
  } else if (link === "slow") {
    note = { text: "Slow connection", tone: "warn" };
  }

  if (!note) return null;

  const accent = note.tone === "bad" ? teamColor.red : teamColor.yellow;

  return (
    <Animated.View
      entering={FadeIn.duration(200).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(160)}
      pointerEvents="none"
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        borderRadius: radius.sm,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
      }}
      accessibilityRole="alert"
      accessibilityLabel={note.text}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />
      <Text style={{ fontFamily: font.medium, fontSize: 12, color: palette.mutedSteel }}>{note.text}</Text>
    </Animated.View>
  );
}

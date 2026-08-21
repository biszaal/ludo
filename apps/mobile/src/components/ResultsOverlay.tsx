/**
 * Full-screen results shown while state.status === "finished". Fades in after a
 * beat so the winning move finishes on the board first. Winner block up top,
 * ranked rows, then Rematch/Home in the thumb zone. Confetti bursts once in the
 * winner's color + Porcelain + a tint.
 *
 * Online, Rematch is a proposal rather than a command (see lib/rematch.ts): the
 * button opens it, everyone still seated answers, and the accepters get dealt a
 * fresh board. While one is standing the thumb zone becomes the ballot — who
 * has answered, how long is left, and the two buttons that are now the whole
 * question.
 */

import { useEffect, useState } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, FadeInDown } from "react-native-reanimated";
import type { GameState } from "@ludo/engine";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { AvatarGlyph } from "./Avatar";
import { AddFriendButton } from "./AddFriendButton";
import { Surface3D } from "./Surface3D";
import { computeStandings } from "../lib/standings";
import { eligibleSeats, type Proposal } from "../lib/rematch";
import { payoutSplit } from "../lib/economy";
import { useLayout } from "../lib/useLayout";
import { font, palette, radius, space, teamColor, teamTint } from "../theme";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

/** Online rematch voting. Omitted in local play, where Rematch just restarts. */
export interface RematchVoting {
  /** The standing proposal, or null when nobody has opened one. */
  proposal: Proposal | null;
  /** This device's auth user id — which of the ballot's seats is mine. */
  myUserId: string | null;
  /** Why the last proposal produced no game, if it didn't. */
  notice: string | null;
  /** Open a proposal (also counts as this seat's yes). */
  onPropose: () => void;
  /** Answer the standing proposal. */
  onAnswer: (accept: boolean) => void;
}

interface ResultsOverlayProps {
  state: GameState;
  /** Display name for a seat; defaults to the color label. */
  nameFor?: (playerId: string) => string | null;
  /** Avatar id for a seat (null → color chip). */
  avatarFor?: (playerId: string) => string | null;
  /** Hidden when undefined (local play with no previous setup to repeat).
   *  Ignored when `rematch` is supplied — online, the button opens a vote. */
  onRematch?: () => void;
  /** Online: turn Rematch into a proposal every remaining seat votes on. */
  rematch?: RematchVoting;
  /** Shown under the buttons (e.g. "Waiting for the host…"). */
  footnote?: string | null;
  /** Online only: offer "Add friend" on other players (real auth users). */
  canAddFriends?: boolean;
  /** Coins each seat staked (0/undefined = friendly game, no payout lines). */
  stake?: number;
  /** Entry delay (ms) — long by default so the winning move lands on the board
   *  first; short when revealed from the celebration screen (a tapped button
   *  must answer immediately). */
  enterDelayMs?: number;
  onHome: () => void;
}

/** 2 → "2nd", 3 → "3rd", 4 → "4th" (ranks only ever run 1–4). */
function ordinal(rank: number): string {
  return rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
}

export function ResultsOverlay({ state, nameFor, avatarFor, onRematch, rematch, footnote, canAddFriends = false, stake = 0, enterDelayMs = 900, onHome }: ResultsOverlayProps) {
  const userIdOf = (playerId: string) => state.players.find((p) => p.id === playerId)?.userId ?? null;
  const { width, height } = useWindowDimensions();
  const { maxWidth } = useLayout();
  // Keep the standings + buttons in a readable centered column on a tablet
  // instead of stretching them across the whole screen.
  const col = { width: "100%" as const, maxWidth, alignSelf: "center" as const };
  const standings = computeStandings(state);
  // What each place is actually credited — see payoutSplit. Index 0 is the
  // winner, so a row at rank N reads shares[N - 1].
  const shares = payoutSplit(stake, state.players.length);
  const winner = standings[0]!;
  const winnerName = nameFor?.(winner.playerId) ?? COLOR_LABEL[winner.color];
  const winnerAvatar = avatarFor?.(winner.playerId) ?? null;

  return (
    <Animated.View
      entering={FadeIn.delay(enterDelayMs).duration(450)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        // Above the game HUD — the corner-chip rows carry zIndex (for chat
        // bubbles) and would otherwise draw over this overlay on iOS.
        zIndex: 40,
        backgroundColor: "rgba(20,23,28,0.94)",
        paddingHorizontal: space.xl,
        justifyContent: "space-between",
      }}
    >
      <Confetti
        width={width}
        height={height}
        originX={width / 2}
        originY={height * 0.3}
        // Staked wins rain coin golds; friendly wins burst in the winner's color.
        colors={
          stake > 0
            ? ["#F5C542", "#FFE08A", "#C8951B"]
            : [teamColor[winner.color], palette.porcelain, teamTint[winner.color]]
        }
      />

      {/* Winner block */}
      <Animated.View entering={FadeInDown.delay(enterDelayMs + 150).duration(320).easing(Easing.out(Easing.cubic))} style={{ alignItems: "center", marginTop: height * 0.14, gap: space.md }}>
        {winnerAvatar ? (
          <AvatarGlyph id={winnerAvatar} size={72} />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.pill,
              backgroundColor: teamColor[winner.color],
              borderWidth: 3,
              borderColor: palette.porcelain,
            }}
          />
        )}
        <View
          style={{
            paddingHorizontal: space.md,
            paddingVertical: 3,
            borderRadius: radius.pill,
            backgroundColor: palette.porcelain,
          }}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 12, letterSpacing: 1, color: palette.feltCharcoal }}>1ST</Text>
        </View>
        <Text style={{ fontFamily: font.display, fontSize: 26, color: palette.porcelain }}>{winnerName}</Text>
        <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.mutedSteel }}>
          {stake > 0 ? `takes the top share — +${shares[0] ?? 0} coins` : "wins the game"}
        </Text>
      </Animated.View>

      {/* Ranked rows (2nd onward — the winner is the block above). Players who
          left rank last with a "Left" tag instead of a placement. */}
      <View style={{ gap: space.sm, ...col }}>
        {standings.slice(1).map((s) => {
          const gone = !!state.players.find((p) => p.id === s.playerId)?.hasLeft;
          return (
            <Surface3D
              key={s.playerId}
              edge={2}
              faceStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingVertical: space.sm,
                paddingHorizontal: space.md,
                opacity: gone ? 0.55 : 1,
              }}
            >
              <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.mutedSteel, width: 36 }}>
                {gone ? "—" : ordinal(s.rank)}
              </Text>
              <View style={{ width: 12, height: 12, borderRadius: radius.pill, backgroundColor: teamColor[s.color] }} />
              <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
                {nameFor?.(s.playerId) ?? COLOR_LABEL[s.color]}
              </Text>
              {!gone && canAddFriends && userIdOf(s.playerId) ? <AddFriendButton userId={userIdOf(s.playerId)!} /> : null}
              <Text
                style={{
                  fontFamily: font.mono,
                  fontSize: 13,
                  // A paid place is the point of playing a losing game out —
                  // give it the winner's colour rather than the loss grey.
                  color: !gone && stake > 0 && (shares[s.rank - 1] ?? 0) > 0 ? palette.porcelain : palette.mutedSteel,
                }}
              >
                {gone
                  ? "Left"
                  : stake > 0
                    ? (shares[s.rank - 1] ?? 0) > 0
                      ? `+${shares[s.rank - 1]}`
                      : `−${stake}`
                    : `${s.finished}/4`}
              </Text>
            </Surface3D>
          );
        })}
      </View>

      {/* Actions — the ballot when this is an online room, where Rematch has to
          be agreed rather than announced. */}
      <View style={{ gap: space.sm, marginBottom: space.xxl, ...col }}>
        {rematch ? (
          <RematchBallot state={state} rematch={rematch} nameFor={nameFor} avatarFor={avatarFor} />
        ) : onRematch ? (
          <Button label="Rematch" onPress={onRematch} />
        ) : null}
        <Button label="Home" onPress={onHome} variant="ghost" />
        {footnote ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>{footnote}</Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

/** Whole seconds left on a proposal — 0 when there isn't one. */
function remaining(endsAt: number | null): number {
  return endsAt == null ? 0 : Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

/**
 * The proposal's countdown.
 *
 * Ticked twice a second rather than once: the displayed number is a ceiling of
 * the real remainder, so a 1s interval that starts out of phase with it shows
 * each value up to a second late — which on a 30-second clock is visible as a
 * countdown that skips.
 */
function useSecondsLeft(endsAt: number | null): number {
  const [left, setLeft] = useState(() => remaining(endsAt));
  useEffect(() => {
    setLeft(remaining(endsAt));
    if (endsAt == null) return;
    const id = setInterval(() => setLeft(remaining(endsAt)), 500);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

/**
 * Rematch as a question the whole table answers.
 *
 * With no proposal standing this is just the Rematch button — tapping it opens
 * one. With a proposal standing it becomes the ballot: every seat that still
 * has a say, what they've said, and (for whoever hasn't answered) the two
 * buttons. The seat strip is deliberately the same information for everyone,
 * including the people who have already voted: "am I waiting on anyone, and
 * who" is the only question left on this screen, and it should not need
 * anybody to guess.
 */
function RematchBallot({
  state,
  rematch,
  nameFor,
  avatarFor,
}: {
  state: GameState;
  rematch: RematchVoting;
  nameFor?: (playerId: string) => string | null;
  avatarFor?: (playerId: string) => string | null;
}) {
  const { proposal, myUserId, notice, onPropose, onAnswer } = rematch;
  const seconds = useSecondsLeft(proposal?.endsAt ?? null);
  const seats = eligibleSeats(state);
  const colorOf = (playerId: string) => state.players.find((p) => p.id === playerId)!.color;
  const labelOf = (playerId: string) => nameFor?.(playerId) ?? COLOR_LABEL[colorOf(playerId)];

  if (!proposal) {
    return (
      <>
        <Button label="Rematch" onPress={onPropose} />
        {notice ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
            {notice}
          </Text>
        ) : null}
      </>
    );
  }

  const myVote = myUserId ? proposal.votes[myUserId] : undefined;
  const proposer = seats.find((seat) => seat.userId === proposal.byUserId);
  const accepted = seats.filter((seat) => proposal.votes[seat.userId] === "yes").length;

  return (
    <>
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain, textAlign: "center" }}>
        {proposal.byUserId === myUserId
          ? "You asked for a rematch"
          : `${proposer ? labelOf(proposer.playerId) : "Someone"} wants a rematch`}
      </Text>

      <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg, paddingVertical: space.xs }}>
        {seats.map((seat) => {
          const vote = proposal.votes[seat.userId];
          const avatar = avatarFor?.(seat.playerId) ?? null;
          return (
            // Undecided seats sit back rather than disappear: the empty chair
            // is the reason the clock is running.
            <View key={seat.playerId} style={{ alignItems: "center", gap: space.xs, opacity: vote ? 1 : 0.45 }}>
              <View>
                {avatar ? (
                  <AvatarGlyph id={avatar} size={36} />
                ) : (
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: radius.pill,
                      backgroundColor: teamColor[colorOf(seat.playerId)],
                    }}
                  />
                )}
                {vote ? (
                  <View
                    style={{
                      position: "absolute",
                      right: -3,
                      bottom: -3,
                      width: 17,
                      height: 17,
                      borderRadius: radius.pill,
                      backgroundColor: vote === "yes" ? teamColor.green : teamColor.red,
                      alignItems: "center",
                      justifyContent: "center",
                      // Cut the badge out of the avatar rather than letting it
                      // sit on the edge of one.
                      borderWidth: 2,
                      borderColor: palette.feltCharcoal,
                    }}
                  >
                    <Text style={{ fontFamily: font.semibold, fontSize: 9, lineHeight: 12, color: palette.porcelain }}>
                      {vote === "yes" ? "✓" : "✕"}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={{ fontFamily: font.medium, fontSize: 11, color: palette.mutedSteel, maxWidth: 68 }}
              >
                {labelOf(seat.playerId)}
              </Text>
            </View>
          );
        })}
      </View>

      {myVote ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
          {myVote === "yes"
            ? `${accepted} of ${seats.length} in — waiting on the rest · ${seconds}s`
            : `You passed. It plays on without you if two others are in · ${seconds}s`}
        </Text>
      ) : (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={`Rematch · ${seconds}s`} onPress={() => onAnswer(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="No thanks" variant="ghost" onPress={() => onAnswer(false)} />
          </View>
        </View>
      )}
    </>
  );
}

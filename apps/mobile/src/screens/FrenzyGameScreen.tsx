/**
 * Frenzy vs AI — wires the shared GameView, in its Frenzy configuration, to
 * the Frenzy store. There are no turns: every seat's die sits at its chip, the
 * human rolls theirs whenever it is ready, and the bots race on their own
 * clocks. The pause menu stops every clock, and so does leaving the app — a
 * game must not be lost to bots that kept playing in the background.
 *
 * Reactions work as in local vs AI: one-way, on-device bubbles.
 */

import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { getValidMoves } from "@ludo/engine";
import { GameView, type GameChat } from "../components/GameView";
import { resolveEmoji } from "../lib/emoji";
import { playSound } from "../lib/sound";
import { useFrenzyStore } from "../store/frenzyStore";
import { useProfile } from "../store/profileStore";
import { colorLabel, useT } from "../i18n";

export function FrenzyGameScreen() {
  const t = useT();
  const state = useFrenzyStore((s) => s.state);
  const seats = useFrenzyStore((s) => s.seats);
  const me = useFrenzyStore((s) => s.me);
  const botIds = useFrenzyStore((s) => s.botIds);
  const paused = useFrenzyStore((s) => s.paused);
  const lastConfig = useFrenzyStore((s) => s.lastConfig);
  const roll = useFrenzyStore((s) => s.roll);
  const selectToken = useFrenzyStore((s) => s.selectToken);
  const setPaused = useFrenzyStore((s) => s.setPaused);
  const leaveGame = useFrenzyStore((s) => s.leaveGame);
  const newFrenzyGame = useFrenzyStore((s) => s.newFrenzyGame);
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const diceSkinId = useProfile((s) => s.diceSkinId);

  const [myBubble, setMyBubble] = useState<{ value: string; kind: "reaction"; seq: number } | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") useFrenzyStore.getState().setPaused(true);
    });
    return () => sub.remove();
  }, []);

  const myMoves = useMemo(() => (state && me ? getValidMoves(state, me) : []), [state, me]);

  if (!state) return null;

  const human = state.players.find((p) => p.id === me);
  const mySeat = me ? seats[me] : undefined;
  const holding = mySeat?.held != null;
  const active = state.status === "active";
  const racing = !!me && active && !state.finishedOrder.includes(me);

  const hint = !racing
    ? t("frenzy.watching")
    : holding
      ? myMoves.length === 0
        ? t("game.noMovesPassing")
        : t("game.tapGlowingToken")
      : mySeat?.ready
        ? t("game.tapDieToRoll")
        : t("frenzy.recharging");

  const chat: GameChat | undefined = human
    ? {
        events: [],
        unread: 0,
        latestBubbles: myBubble ? { [human.userId]: myBubble } : {},
        myUserId: human.userId,
        onSendReaction: (value) => {
          const spec = resolveEmoji(value);
          if (spec) playSound(spec.sound);
          setMyBubble({ value, kind: "reaction", seq: (myBubble?.seq ?? 0) + 1 });
        },
        onSendMessage: () => {},
        onOpened: () => {},
        reactionsOnly: true,
      }
    : undefined;

  const nameFor = (playerId: string): string | null => {
    const seat = state.players.find((p) => p.id === playerId)!;
    return botIds.includes(playerId) ? t("status.aiSeat", { color: colorLabel(seat.color) }) : displayName;
  };

  return (
    <GameView
      state={state}
      validMoves={myMoves}
      lastRoll={null}
      rollSeq={0}
      message={t("mode.frenzyHint")}
      hint={hint}
      canAct={racing && holding && myMoves.length > 0}
      onRoll={roll}
      onSelectToken={selectToken}
      onLeave={leaveGame}
      onRematch={lastConfig ? () => newFrenzyGame(lastConfig) : undefined}
      nameFor={nameFor}
      avatarFor={(playerId) => (playerId === me ? avatarId : null)}
      diceSkinFor={(playerId) => (playerId === me ? diceSkinId : null)}
      viewColor={human?.color}
      chat={chat}
      frenzy={{ me, seats }}
      paused={paused}
      onPausedChange={setPaused}
    />
  );
}

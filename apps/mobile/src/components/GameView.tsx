/**
 * Presentational game view shared by local and online play. It renders the
 * board, players, dice and the context action from props alone — the local and
 * online screens wire it to their respective stores. `canAct` gates all input
 * (false during a bot turn or an opponent's online turn).
 *
 * Overlays live here (DESIGN d5): the pause sheet and the results screen render
 * over the live board without touching game state or the realtime socket.
 * Android back pauses/resumes instead of leaving.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeOut, ZoomIn } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Color, GameState, Move } from "@ludo/engine";
import { Board } from "./Board";
import { ChatSheet } from "./ChatSheet";
import { Dice } from "./Dice";
import { PauseMenu } from "./PauseMenu";
import { PlayerChip } from "./PlayerChip";
import { ReactionBar } from "./ReactionBar";
import { ChatBubble } from "./ChatBubble";
import { ResultsOverlay } from "./ResultsOverlay";
import { WinnerCelebration } from "./WinnerCelebration";
import { FinishedPrompt } from "./FinishedPrompt";
import { TableBackground } from "./TableBackground";
import { CoinGlyph } from "./CoinsPill";
import { ContentColumn } from "./ContentColumn";
import { useLayout } from "../lib/useLayout";
import type { ChatEvent } from "../store/onlineStore";
import { font, palette, radius, space, teamColor } from "../theme";
import { BOARD_THEMES } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import { setBackInterceptor } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { shareInvite } from "../lib/invite";
import { payoutSplit, potFor } from "../lib/economy";
import { useAds, canShowInterstitial } from "../store/adsStore";
import { useConfig } from "../store/configStore";
import { preloadInterstitial, showInterstitial } from "../lib/ads/provider";

interface GameViewProps {
  state: GameState;
  validMoves: Move[];
  lastRoll: number | null;
  rollSeq: number;
  message: string;
  /** May the local user act right now? */
  canAct: boolean;
  /** Shown in the action area when it's not the local user's turn (and not finished). */
  waitingLabel?: string | null;
  onRoll: () => void;
  onSelectToken: (tokenId: string) => void;
  onLeave: () => void;
  /** Results: hidden when undefined (online guest waits for the host). */
  onRematch?: () => void;
  /** Two-step leave confirmation (online). */
  confirmLeave?: boolean;
  /** Seat display names/avatars; fall back to color labels/chips. */
  nameFor?: (playerId: string) => string | null;
  avatarFor?: (playerId: string) => string | null;
  /** Seat's equipped dice skin id; unset/unknown falls back to classic (the
   *  viewer's own board theme) inside <Dice> itself. */
  diceSkinFor?: (playerId: string) => string | null;
  /** Online: has this seat's player dropped? (shows an "Away" badge). */
  offlineFor?: (playerId: string) => boolean;
  /** Online: is this seat an openly-labelled bot the host filled in? Quick
   *  match never reports true — those fill-ins stay indistinguishable. */
  botFor?: (playerId: string) => boolean;
  /** Online: has this seat's player left for good? (dims the chip, "Left"). */
  leftFor?: (playerId: string) => boolean;
  /** Online: active-turn countdown shown on the current player's panel. */
  turnTimer?: { seq: number; seconds: number } | null;
  /** Local seat on autopilot: BOT badge on that chip; tapping it reclaims control. */
  autoPilot?: { playerId: string; onTakeControl: () => void } | null;
  /** Small line under the results buttons (e.g. "Waiting for the host…"). */
  resultsFootnote?: string | null;
  /** Online room code, shown in the top bar. */
  roomCode?: string | null;
  /** Coins each seat staked (0 = friendly). Shows the pot in the top bar. */
  stake?: number;
  /** Local player's color — the board rotates so this seat is bottom-left. */
  viewColor?: Color;
  /** In-room reactions + chat (online only; local play omits it). */
  chat?: GameChat;
}

export interface GameChat {
  events: ChatEvent[];
  unread: number;
  latestBubbles: Record<string, { value: string; kind: "reaction" | "text"; seq: number }>;
  myUserId: string | null;
  onSendReaction: (value: string) => void;
  onSendMessage: (text: string) => void;
  /** Called when the sheet opens — clears the unread badge. */
  onOpened: () => void;
  /** Local play: reactions work but there is nobody to text — hide the chat sheet. */
  reactionsOnly?: boolean;
}

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

type TeamColor = "red" | "green" | "yellow" | "blue";
/** Color whose yard sits at each screen corner (CW: 0=TL,1=TR,2=BR,3=BL) with no rotation. */
const COLOR_BY_CORNER: TeamColor[] = ["red", "green", "yellow", "blue"];
/** Quarter-turns (90° CW) that bring each color's yard to the bottom-left. Mirrors Board. */
const VIEW_QUARTER: Record<TeamColor, number> = { red: 3, green: 2, yellow: 1, blue: 0 };
const TL = 0;
const TR = 1;
const BR = 2;
const BL = 3;

export function GameView({
  state,
  validMoves,
  lastRoll,
  rollSeq,
  message,
  canAct,
  waitingLabel,
  onRoll,
  onSelectToken,
  onLeave,
  onRematch,
  confirmLeave,
  nameFor,
  avatarFor,
  diceSkinFor,
  offlineFor,
  botFor,
  leftFor,
  turnTimer,
  autoPilot,
  resultsFootnote,
  roomCode,
  stake = 0,
  viewColor,
  chat,
}: GameViewProps) {
  const { width, height } = useWindowDimensions();
  const { maxWidth, isTablet, scale } = useLayout();
  const theme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];
  const [paused, setPaused] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // On a tablet the board grows to fill the centered column and a bit more
  // height; on a phone this is exactly the old min(width−48, height·0.44).
  const colWidth = maxWidth ?? width;
  const boardSize = Math.floor(Math.min(colWidth - space.xl * 2, height * (isTablet ? 0.5 : 0.44)));
  const diceSize = Math.round(48 * scale);
  const finished = state.status === "finished";
  // Every seat's entry, bot seats included — matches what the server pays out.
  const pot = potFor(stake, state.players.length);
  // Seat each player's profile at the board corner nearest their yard.
  const byColor = useMemo(() => new Map(state.players.map((p) => [p.color, p] as const)), [state.players]);

  // The board rotates so `viewColor` sits bottom-left; the corner chips follow,
  // so each color's chip stays pinned to its (rotated) yard corner on screen.
  // Screen corners in clockwise order: 0=TL, 1=TR, 2=BR, 3=BL.
  const q = viewColor ? VIEW_QUARTER[viewColor] : 0;
  const colorAtCorner = (screen: number): TeamColor => COLOR_BY_CORNER[(screen - q + 4) % 4]!;

  // Android back: toggle the pause sheet instead of abandoning the game.
  useEffect(() => {
    setBackInterceptor(() => {
      setPaused((p) => !p);
      return true;
    });
    return () => setBackInterceptor(null);
  }, []);

  // Winner celebration: fires once when the game's champion is decided (the
  // first seat to finish all four tokens) — including the 2-player case where
  // that same move ends the game. Dismissing it either resumes the room (minor
  // places still racing) or, on game over, reveals the results leaderboard.
  const [celebrating, setCelebrating] = useState(false);
  // "See results" was tapped — the results screen must answer immediately
  // instead of waiting out its usual let-the-move-land entry delay.
  const fromCelebration = useRef(false);
  const prevFinishedCount = useRef(state.finishedOrder.length);
  useEffect(() => {
    const was = prevFinishedCount.current;
    const now = state.finishedOrder.length;
    prevFinishedCount.current = now;
    if (was === 0 && now >= 1) setCelebrating(true);
    else if (now === 0) {
      // Rematch reset — a fresh game gets a fresh celebration.
      setCelebrating(false);
      fromCelebration.current = false;
    }
  }, [state.finishedOrder.length]);
  const championId = state.finishedOrder[0] ?? null;
  const champion = championId ? state.players.find((p) => p.id === championId) : undefined;
  // Is the local seat still racing for a place? (Labels the stay button.)
  const mySeat = viewColor ? state.players.find((p) => p.color === viewColor) : undefined;
  const myPlaceIndex = mySeat ? state.finishedOrder.indexOf(mySeat.id) : -1;
  const stillPlaying = !!mySeat && myPlaceIndex === -1 && !mySeat.hasLeft;

  // Ask a player who has just come home whether they want to stay for the rest.
  // Only the champion used to be offered anything; a 2nd or 3rd place finisher
  // was left spectating a match they were done with, with no indication that
  // leaving keeps their placement (it does — see FinishedPrompt).
  const [finishPrompt, setFinishPrompt] = useState(false);
  const dismissedFinish = useRef(false);
  useEffect(() => {
    if (myPlaceIndex === -1) {
      // Fresh game or rematch — arm the prompt again.
      dismissedFinish.current = false;
      setFinishPrompt(false);
      return;
    }
    if (dismissedFinish.current) return;
    dismissedFinish.current = true;
    // The champion is asked the very same question by WinnerCelebration ("Watch
    // the rest" / "Leave"), so only the minor places need this.
    if (myPlaceIndex > 0) setFinishPrompt(true);
  }, [myPlaceIndex]);

  // Ad bookkeeping. Recorded once per match, on the transition into finished —
  // whether the local seat WON matters, because losing a staked match is the
  // one moment an interstitial must never follow.
  const countedFinish = useRef(false);
  useEffect(() => {
    if (!finished) {
      countedFinish.current = false;
      return;
    }
    if (countedFinish.current) return;
    countedFinish.current = true;
    const iWon = !!mySeat && championId === mySeat.id;
    useAds.getState().noteMatchFinished(stake > 0, iWon);
  }, [finished, championId, mySeat, stake]);

  // Warm an interstitial while the match plays out — matches run minutes, so
  // there is always time, and the seam never waits on the network.
  useEffect(() => {
    if (!finished) preloadInterstitial();
  }, [finished]);

  /** Show the end-of-match interstitial if every gate allows it. */
  const maybeShowEndOfMatchAd = useCallback(async () => {
    // TODO(phase-8): real `noads` entitlement once coin packs ship.
    if (!canShowInterstitial(useAds.getState(), useConfig.getState().config, false)) return;
    const shown = await showInterstitial();
    if (shown) useAds.getState().noteInterstitialShown();
  }, []);

  // Capture toast: a token was just sent home — flash a one-liner over the
  // board (timed near the capture sound's arrival delay).
  const [toast, setToast] = useState<{ text: string; seq: number } | null>(null);
  const prevTokensRef = useRef(state.tokens);
  useEffect(() => {
    const prev = prevTokensRef.current;
    prevTokensRef.current = state.tokens;
    if (prev === state.tokens || state.status !== "active") return;
    const wasHome = new Set(prev.filter((t) => t.position === "home").map((t) => t.id));
    const captured = state.tokens.some((t) => t.position === "home" && !wasHome.has(t.id));
    if (!captured) return;
    const lines = ["Gotcha!", "Sent home!", "Boom!"];
    setToast((s) => ({ text: lines[Math.floor(Math.random() * lines.length)]!, seq: (s?.seq ?? 0) + 1 }));
  }, [state.tokens, state.status]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  // Stable movable lookup: a Set rebuilt only when the moves change, so Board's
  // per-token checks don't rescan validMoves on every store write.
  const movableIds = useMemo(
    () => (canAct ? new Set(validMoves.map((m) => m.tokenId)) : null),
    [canAct, validMoves],
  );
  const movable = useCallback((id: string) => movableIds?.has(id) ?? false, [movableIds]);
  const noop = () => {};

  const nameForUser = (userId: string): string => {
    if (chat && userId === chat.myUserId) return "You";
    const pl = state.players.find((p) => p.userId === userId);
    if (!pl) return "Player";
    return nameFor?.(pl.id) ?? COLOR_LABEL[pl.color];
  };

  // A corner profile for the player whose (rotated) yard sits at this screen
  // corner (empty spacer if that seat isn't in play, e.g. 2-player diagonal).
  // The die rides next to whoever is active — by the local user when it's their
  // turn (bottom-left), matching Ludo Club — and IS the roll control: when the
  // local user may roll, the die wiggles and tapping it rolls.
  const cornerChip = (screen: number) => {
    const align = screen === TL || screen === BL ? "left" : "right";
    // Bubbles always pop toward the board: top chips downward (never over the
    // top bar), bottom chips upward — like Ludo King / Ludo Club.
    const vAlign = screen === TL || screen === TR ? "below" : "above";
    const p = byColor.get(colorAtCorner(screen));
    if (!p) return <View style={{ width: 92 }} />;
    const isActive = p.id === state.currentTurnPlayerId && !finished;
    const gone = leftFor?.(p.id) ?? false;
    const bubble = gone ? undefined : chat?.latestBubbles[p.userId];
    const canRoll = isActive && canAct && !paused && state.phase === "awaiting-roll";
    // Autopilot seat: BOT badge, tap reclaims, and no countdown ring — the bot
    // acts long before any deadline, so a ticking ring would be noise.
    const pilot = autoPilot?.playerId === p.id;
    // A host-filled bot wears the same badge (it says the same thing) but is
    // not tappable — there is no human behind it to hand control back to.
    const filledBot = !pilot && (botFor?.(p.id) ?? false);
    return (
      <View style={{ flexDirection: align === "left" ? "row" : "row-reverse", alignItems: "center", gap: space.md }}>
        <View>
          <PlayerChip
            player={p}
            state={state}
            active={isActive}
            label={nameFor?.(p.id) ?? undefined}
            avatarId={avatarFor?.(p.id) ?? null}
            offline={offlineFor?.(p.id) ?? false}
            left={gone}
            timer={isActive && !pilot && !filledBot ? turnTimer : null}
            align={align}
            botMode={pilot || filledBot}
            onPress={pilot ? autoPilot?.onTakeControl : null}
          />
          {bubble ? <ChatBubble value={bubble.value} kind={bubble.kind} seq={bubble.seq} align={align} vAlign={vAlign} /> : null}
        </View>
        {isActive ? (
          // Constant size — resizing mid-roll made the face flicker/jump.
          // On an autopilot seat the die stays tappable too: tapping it (like
          // tapping the avatar) hands control back to the human.
          <Dice
            value={state.diceValue ?? lastRoll}
            spinSeq={rollSeq}
            size={diceSize}
            idle={state.phase === "awaiting-roll"}
            theme={theme}
            skin={resolveDiceSkin(diceSkinFor?.(p.id) ?? null)}
            onRollPress={canRoll ? onRoll : pilot ? autoPilot?.onTakeControl ?? null : null}
            pressLabel={canRoll ? "Roll the dice" : "Bot is playing for you — tap to take back control"}
          />
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground width={width} height={height} />
      {/* Centered column on tablet so the board and the corner chips share one
          readable width instead of spanning the whole iPad; full-width on phone. */}
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: Math.round(22 * scale), color: palette.porcelain }}>Ludo</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {stake > 0 ? (
              <View
                accessibilityLabel={`Pot: ${pot} coins`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: space.sm,
                  paddingVertical: 4,
                  borderRadius: radius.pill,
                  backgroundColor: palette.liftedSlate,
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,255,255,0.10)",
                }}
              >
                <CoinGlyph size={14} />
                <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.porcelain }}>{pot}</Text>
              </View>
            ) : null}
            {roomCode ? (
              // Tapping the code opens the share sheet — invite a friend mid-room.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Share room code ${roomCode}`}
                onPress={() => void shareInvite(roomCode, stake)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: space.sm,
                  paddingVertical: 4,
                  borderRadius: radius.sm,
                  backgroundColor: palette.liftedSlate,
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,255,255,0.10)",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.porcelain, letterSpacing: 2 }}>{roomCode}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: palette.mutedSteel }}>SHARE</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={{ flex: 1, justifyContent: "center" }}>
          {/* Top-of-board profiles (screen corners), then the board, then bottom.
              zIndex keeps chat bubbles (which pop past the row's bounds toward
              the board) drawing over the board instead of under it. */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: space.sm, zIndex: 2 }}>
            {cornerChip(TL)}
            {cornerChip(TR)}
          </View>

          <View style={{ alignItems: "center" }}>
            <Board size={boardSize} state={state} theme={theme} isMovable={movable} onSelectToken={canAct && !paused ? onSelectToken : noop} viewColor={viewColor} />
            {toast ? (
              <Animated.View
                key={toast.seq}
                entering={ZoomIn.delay(350).duration(220).easing(Easing.out(Easing.back(1.6)))}
                exiting={FadeOut.duration(180)}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: "42%",
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: "rgba(20,23,28,0.88)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.14)",
                  zIndex: 5,
                }}
              >
                <Text style={{ fontFamily: font.display, fontSize: 18, color: palette.porcelain }}>{toast.text}</Text>
              </Animated.View>
            ) : null}
          </View>

          {/* The local player's yard is bottom-left, so their chip + die live here. */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: space.sm, zIndex: 2 }}>
            {cornerChip(BL)}
            {cornerChip(BR)}
          </View>
        </View>

        <View style={{ gap: space.xs, marginBottom: space.sm, alignItems: "center" }}>
          <Text style={{ fontFamily: font.medium, fontSize: Math.round(16 * scale), color: palette.porcelain, textAlign: "center" }}>{message}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: Math.round(13 * scale), color: palette.mutedSteel, textAlign: "center" }}>
            {finished
              ? " "
              : !canAct
                ? waitingLabel ?? "Waiting…"
                : state.phase === "awaiting-roll"
                  ? "Tap the die to roll"
                  : validMoves.length === 0
                    ? "No moves — passing…"
                    : "Tap a glowing token to move"}
          </Text>
        </View>

        {/* Bottom-left action cluster — reactions, chat and menu live in the
            thumb zone (Ludo Club convention), not the top bar. */}
        <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.sm }}>
          {chat ? (
            <>
              <IconButton label="Reactions" glyph="🙂" onPress={() => setReactionsOpen((v) => !v)} />
              {!chat.reactionsOnly ? (
                <IconButton
                  label="Chat"
                  glyph="💬"
                  showDot={chat.unread > 0}
                  onPress={() => {
                    chat.onOpened();
                    setChatOpen(true);
                  }}
                />
              ) : null}
            </>
          ) : null}
          <MenuButton onPress={() => setPaused(true)} />
        </View>
      </ContentColumn>

      {celebrating && champion && (
        <WinnerCelebration
          winnerName={nameFor?.(champion.id) ?? COLOR_LABEL[champion.color]}
          winnerColor={champion.color}
          winnerAvatar={avatarFor?.(champion.id) ?? null}
          gameOver={finished}
          stillPlaying={stillPlaying}
          pot={pot}
          onStay={() => {
            fromCelebration.current = finished;
            // The one interstitial seam in the app. The player has just asked
            // to move on, so a full-screen ad here costs no perceived
            // responsiveness — and every gate lives in canShowInterstitial,
            // including "never right after losing a staked match".
            void maybeShowEndOfMatchAd();
            setCelebrating(false);
          }}
          onLeave={() => {
            setCelebrating(false);
            onLeave();
          }}
        />
      )}

      {/* Only while the game runs on: once it's over the results leaderboard is
          the better answer, and the champion already has WinnerCelebration. */}
      {finishPrompt && !finished && !celebrating && mySeat && (
        <FinishedPrompt
          place={myPlaceIndex + 1}
          color={mySeat.color}
          avatarId={avatarFor?.(mySeat.id) ?? null}
          reward={payoutSplit(stake, state.players.length)[myPlaceIndex] ?? 0}
          onWatch={() => setFinishPrompt(false)}
          onLeave={() => {
            setFinishPrompt(false);
            onLeave();
          }}
        />
      )}

      {finished && !celebrating && (
        <ResultsOverlay
          state={state}
          nameFor={nameFor}
          avatarFor={avatarFor}
          onRematch={onRematch}
          footnote={resultsFootnote}
          canAddFriends={!!chat && !chat.reactionsOnly}
          stake={stake}
          enterDelayMs={fromCelebration.current ? 100 : 900}
          onHome={onLeave}
        />
      )}

      {paused && !finished && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onLeave={() => {
            setPaused(false);
            onLeave();
          }}
          confirmLeave={confirmLeave}
          // Only a seat still racing has anything to lose: a player who already
          // finished keeps their place in finishedOrder, and the server pays it
          // out when the match ends whether or not they stayed to watch.
          forfeitCoins={stillPlaying ? stake : 0}
        />
      )}

      {reactionsOpen && chat && !finished && (
        <ReactionBar onSend={chat.onSendReaction} onClose={() => setReactionsOpen(false)} />
      )}

      {chatOpen && chat && (
        <ChatSheet
          events={chat.events}
          nameForUser={nameForUser}
          myUserId={chat.myUserId}
          onSend={chat.onSendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

/** Round emoji-glyph button in the game top bar (reactions, chat). */
function IconButton({ label, glyph, onPress, showDot = false }: { label: string; glyph: string; onPress: () => void; showDot?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Text style={{ fontSize: 20 }}>{glyph}</Text>
      {showDot ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: radius.pill,
            backgroundColor: teamColor.red,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Drawn ≡ menu glyph — 44px target, no icon fonts. */
function MenuButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Game menu"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 18, height: 2, borderRadius: 1, backgroundColor: palette.porcelain }} />
      ))}
    </Pressable>
  );
}

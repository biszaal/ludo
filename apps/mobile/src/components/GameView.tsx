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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { ResultsOverlay, type RematchVoting } from "./ResultsOverlay";
import { WinnerCelebration } from "./WinnerCelebration";
import { FinishedPrompt } from "./FinishedPrompt";
import { TableBackground } from "./TableBackground";
import { CoinGlyph } from "./CoinsPill";
import { ContentColumn } from "./ContentColumn";
import { useLayout } from "../lib/useLayout";
import {
  CHIP_COLUMN,
  GAME_RAIL_MIN,
  gameColumnWidth,
  gameShape,
  railedBoardSize,
  stackedBoardSize,
} from "../lib/layout";
import type { ChatEvent } from "../store/onlineStore";
import { font, palette, radius, space, teamColor } from "../theme";
import { resolveBoardTheme } from "../render/boardThemes";
import { resolveDiceSkin } from "../render/diceSkins";
import { setBackInterceptor } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { payoutSplit, potFor } from "../lib/economy";
import { clockStartFor, elapsedSeconds, formatElapsed } from "../lib/gameClock";
import { matchOverForSeat, seatFinish } from "../lib/seatFinish";
import { useDieHandover } from "../lib/useDieHandover";
import { useAds, canShowInterstitial } from "../store/adsStore";
import { useConfig } from "../store/configStore";
import { preloadInterstitial, showInterstitial } from "../lib/ads/provider";

/** Height the top bar ("Ludo" and its pills) occupies. Only the railed layout
 *  needs it: that one budgets the board's height by hand, where the stacked one
 *  lets flex do the measuring. */
const TOP_BAR_HEIGHT = 40;

/** Module-level so Board's `onSelectToken` prop keeps a stable identity when
 *  taps are off — a fresh `() => {}` per render defeats Board's memo. */
const NOOP = () => {};

interface GameViewProps {
  state: GameState;
  validMoves: Move[];
  lastRoll: number | null;
  rollSeq: number;
  message: string;
  /** May the local user act right now? */
  canAct: boolean;
  /**
   * A busted third six is being held on screen before the turn hands over.
   *
   * The die needs this because the held state is still the PRE-bust one, so
   * `phase` reads "awaiting-roll" throughout — and a die told it is awaiting a
   * roll draws the swirl, wiping the six the hold exists to let people read.
   */
  bustHold?: boolean;
  /** Shown in the action area when it's not the local user's turn (and not finished). */
  waitingLabel?: string | null;
  onRoll: () => void;
  onSelectToken: (tokenId: string) => void;
  onLeave: () => void;
  /** Results: restart with the same setup. Local play only — online, a rematch
   *  is voted on (see `rematch`), not commanded. */
  onRematch?: () => void;
  /** Online: the results screen's Rematch becomes a proposal the table votes on. */
  rematch?: RematchVoting;
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
  /** Slot under the top bar for a transient status line. Online play passes the
   *  connection strip here; local play has no link to report on and passes
   *  nothing, so the row costs an empty fragment and no layout. */
  notice?: ReactNode;
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
  /** Block a player and report the message that prompted it. Online only —
   *  local play has nobody to report, so the sheet's gesture is inert there. */
  onReport?: (userId: string, message: string) => void;
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
  bustHold = false,
  message,
  canAct,
  waitingLabel,
  onRoll,
  onSelectToken,
  onLeave,
  onRematch,
  rematch,
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
  notice,
  stake = 0,
  viewColor,
  chat,
}: GameViewProps) {
  const { width, height } = useWindowDimensions();
  const { tier, scale, insets } = useLayout();
  const theme = resolveBoardTheme(useSettings((s) => s.boardThemeId));
  const [paused, setPaused] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Landscape flips the game screen into its railed form — board flanked by two
  // chip columns, die and buttons in a side rail. See layout.ts for why.
  const shape = gameShape(width, height);
  const railed = shape === "railed";
  // SafeAreaView eats the insets before our column sees them, and in landscape
  // a notch takes ~59pt a side — far too much to ignore the way portrait can.
  const colWidth = gameColumnWidth(shape, tier, width - insets.left - insets.right);
  // Height the board cluster actually gets in the rail: the window less the
  // insets, the top bar and the column's own top padding.
  const railedFreeHeight = height - insets.top - insets.bottom - TOP_BAR_HEIGHT - space.sm;
  const boardSize = railed
    ? railedBoardSize(colWidth, railedFreeHeight)
    : stackedBoardSize(colWidth, height, tier);
  const diceSize = Math.round(48 * scale);

  /**
   * The seat the die is still sitting at, if the roller's pawn is mid-hop.
   * While this is set it overrides the active seat for the die ALONE — the
   * board, the chips and the turn ring all follow the real current player.
   */
  const heldDie = useDieHandover(state, lastRoll, rollSeq);
  const dieSeatId = heldDie?.playerId ?? state.currentTurnPlayerId;
  const dieValue = heldDie ? heldDie.value : state.diceValue ?? lastRoll;

  /**
   * A roll is on screen that the STATE does not know about yet.
   *
   * On a folding table the die is broadcast and the state that explains it
   * arrives later carrying the roll and the move together — so for the whole of
   * an opponent's tumble the phase is still "awaiting-roll". `idle` was derived
   * from the phase alone, and Dice paints the awaiting-roll SWIRL whenever it is
   * set, so an opponent's die tumbled and then settled on a swirl: the number
   * was never drawn at all. That is the "dice glitching on other players"
   * report — tumble, swirl, tumble, swirl, no result ever readable.
   *
   * projection.ts sets `lastRoll` to the state's own die, which is null through
   * an ordinary awaiting-roll, so a number here can only have come from a
   * broadcast (or from prepareRoll on our own tap — the same situation).
   */
  const rollInFlight = state.phase === "awaiting-roll" && lastRoll !== null;
  // Idle means "nothing has been rolled — tap me", and none of the three cases
  // below is that.
  const dieIdle = !heldDie && !rollInFlight && state.phase === "awaiting-roll" && !bustHold;
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

  const championId = state.finishedOrder[0] ?? null;
  const champion = championId ? state.players.find((p) => p.id === championId) : undefined;
  // Is the local seat still racing, and has it banked a place? Every end-of-race
  // screen below gates on this — see lib/seatFinish for why each is what it is.
  const { seat: mySeat, place: myPlaceIndex, stillPlaying, placed: iFinished } = seatFinish(state, viewColor);

  // Winner celebration: fires once when the game's champion is decided (the
  // first seat to finish all four tokens) — but only for a seat that is itself
  // done racing. Someone else's win used to throw this full-screen sheet over
  // every player mid-race, asking whether they wanted to keep playing or leave;
  // a player still walking tokens home now plays on undisturbed, and gets the
  // same question from FinishedPrompt once they bring their last token in.
  // With 2 players the winning move ends the game, so both seats are placed and
  // both see it — and there the sheet only leads on to the results leaderboard.
  const [celebrating, setCelebrating] = useState(false);
  // "See results" was tapped — the results screen must answer immediately
  // instead of waiting out its usual let-the-move-land entry delay.
  const fromCelebration = useRef(false);
  const prevFinishedCount = useRef(state.finishedOrder.length);
  useEffect(() => {
    const was = prevFinishedCount.current;
    const now = state.finishedOrder.length;
    prevFinishedCount.current = now;
    if (now === 0) {
      // Rematch reset — a fresh game gets a fresh celebration.
      setCelebrating(false);
      fromCelebration.current = false;
      return;
    }
    if (was === 0 && !stillPlaying) setCelebrating(true);
  }, [state.finishedOrder.length, stillPlaying]);

  // Is the standings overlay open ahead of the final whistle? (See below — the
  // reset effect clears it, so it has to be declared first.)
  const [standingsOpen, setStandingsOpen] = useState(false);

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
      setStandingsOpen(false);
      return;
    }
    if (dismissedFinish.current) return;
    dismissedFinish.current = true;
    // The champion is asked the very same question by WinnerCelebration ("See
    // standings" / "Watch the rest" / "Leave"), so only the minor places need
    // this.
    if (myPlaceIndex > 0) setFinishPrompt(true);
  }, [myPlaceIndex]);

  // A finished seat waits on nobody. Their placement is banked the moment their
  // last token lands (the engine keeps them in `finishedOrder` whether they
  // stay or go), so they can read the standings right now instead of sitting
  // through the minor places to find out where they came — and still go back to
  // watching, which is the whole reason the match plays on. Only meaningful
  // while the match runs: once it ends the real results screen takes over.
  const liveStandings = standingsOpen && iFinished && !finished;
  const openStandings = useCallback(() => {
    setCelebrating(false);
    setFinishPrompt(false);
    setPaused(false);
    setStandingsOpen(true);
  }, []);

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

  /**
   * Show the end-of-match interstitial if every gate allows it.
   *
   * "End of match" means end of match FOR THIS PLAYER, and the caller owns that
   * judgement — see the two seams below. Everything else (session cap, spacing,
   * never right after losing a staked match) lives in canShowInterstitial.
   */
  const maybeShowEndOfMatchAd = useCallback(async () => {
    // TODO(phase-8): real `noads` entitlement once coin packs ship.
    if (!canShowInterstitial(useAds.getState(), useConfig.getState().config, false)) return;
    const shown = await showInterstitial();
    if (shown) useAds.getState().noteInterstitialShown();
  }, []);

  /**
   * Leave the table, with the ad this player has now earned the right to see.
   *
   * Leaving after finishing is the other moment the match is genuinely over for
   * someone: their placement is banked, they have chosen not to watch the rest,
   * and the next thing they see is the home screen either way. Awaited rather
   * than fired off, because onLeave unmounts this tree and a detached
   * interstitial would be cancelled on its way up.
   */
  const leaveAfterAd = useCallback(async () => {
    if (matchOverForSeat({ placed: iFinished }, { finished, intent: "leave" })) {
      await maybeShowEndOfMatchAd();
    }
    onLeave();
  }, [maybeShowEndOfMatchAd, onLeave, iFinished, finished]);

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

  // Board is memoized, so its callback props must not churn. The screens pass
  // fresh arrow functions (`onSelectToken={(id) => void selectToken(id)}`), so
  // the latest one is kept in a ref and called through a stable wrapper.
  const selectTokenRef = useRef(onSelectToken);
  selectTokenRef.current = onSelectToken;
  const selectTokenStable = useCallback((id: string) => selectTokenRef.current(id), []);
  const boardTappable = canAct && !paused;

  // Tokens each seat has brought home — the only thing PlayerChip read out of
  // the full GameState, counted once here instead of per chip.
  const finishedByPlayer = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of state.tokens) {
      if (t.position === "finished") counts.set(t.playerId, (counts.get(t.playerId) ?? 0) + 1);
    }
    return counts;
  }, [state.tokens]);

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
  const cornerChip = (screen: number, { withDice = true }: { withDice?: boolean } = {}) => {
    const align = screen === TL || screen === BL ? "left" : "right";
    // Bubbles always pop toward the board: top chips downward (never over the
    // top bar), bottom chips upward — like Ludo King / Ludo Club.
    const vAlign = screen === TL || screen === TR ? "below" : "above";
    const p = byColor.get(colorAtCorner(screen));
    if (!p) return <View style={{ width: CHIP_COLUMN }} />;
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
    const showTimer = isActive && !pilot && !filledBot && !!turnTimer;
    return (
      <View style={{ flexDirection: align === "left" ? "row" : "row-reverse", alignItems: "center", gap: space.md }}>
        <View>
          <PlayerChip
            seatColor={p.color}
            finished={finishedByPlayer.get(p.id) ?? 0}
            active={isActive}
            label={nameFor?.(p.id) ?? undefined}
            avatarId={avatarFor?.(p.id) ?? null}
            offline={offlineFor?.(p.id) ?? false}
            left={gone}
            timerSeq={showTimer ? turnTimer!.seq : null}
            timerSeconds={showTimer ? turnTimer!.seconds : 0}
            align={align}
            botMode={pilot || filledBot}
            onPress={pilot ? autoPilot?.onTakeControl ?? null : null}
          />
          {bubble ? <ChatBubble value={bubble.value} kind={bubble.kind} seq={bubble.seq} align={align} vAlign={vAlign} /> : null}
        </View>
        {p.id === dieSeatId && withDice ? (
          // Constant size — resizing mid-roll made the face flicker/jump.
          // On an autopilot seat the die stays tappable too: tapping it (like
          // tapping the avatar) hands control back to the human.
          //
          // While the die is HELD here after the turn moved on, this seat is no
          // longer the active one: the face must show its number rather than
          // the awaiting-roll swirl, and nothing about it may be tappable — the
          // roll it represents is already spent.
          <Dice
            value={dieValue}
            spinSeq={rollSeq}
            size={diceSize}
            idle={dieIdle}
            theme={theme}
            skin={resolveDiceSkin(diceSkinFor?.(p.id) ?? null)}
            onRollPress={heldDie ? null : canRoll ? onRoll : pilot ? autoPilot?.onTakeControl ?? null : null}
            pressLabel={canRoll ? "Roll the dice" : "Bot is playing for you — tap to take back control"}
          />
        ) : null}
      </View>
    );
  };

  const topBar = (
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
        <GameClock gameId={state.gameId} running={state.status === "active"} />
      </View>
    </View>
  );

  const boardWithToast = (
      <View style={{ alignItems: "center" }}>
        <Board
          size={boardSize}
          state={state}
          theme={theme}
          isMovable={movable}
          onSelectToken={boardTappable ? selectTokenStable : NOOP}
          viewColor={viewColor}
        />
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
  );

  const messageBlock = (
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
  );

  // Reactions, chat and menu. Stacked keeps them bottom-left in the thumb zone
  // (Ludo Club convention); railed moves them into the rail, which in landscape
  // is where the right thumb already is.
  const actionCluster = (
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
  );

  // Railed only: the die leaves the active chip for the rail, because a chip
  // column is CHIP_COLUMN wide and a die beside it would not fit. Whose turn it
  // is still reads off that chip's ring and countdown.
  const activeSeat = state.players.find((p) => p.id === state.currentTurnPlayerId) ?? null;
  const activeIsPilot = !!activeSeat && autoPilot?.playerId === activeSeat.id;
  const canRollNow = !!activeSeat && canAct && !paused && state.phase === "awaiting-roll";
  // The rail shows ONE die for the table, so a hold here is about the skin and
  // the face rather than the position: it keeps the roller's die, with their
  // number on it, until their pawn lands. Same reasoning as the corner chips.
  const dieSeat = state.players.find((p) => p.id === dieSeatId) ?? activeSeat;
  const railDie =
    dieSeat && !finished ? (
      <Dice
        value={dieValue}
        spinSeq={rollSeq}
        size={diceSize}
        idle={dieIdle}
        theme={theme}
        skin={resolveDiceSkin(diceSkinFor?.(dieSeat.id) ?? null)}
        onRollPress={heldDie ? null : canRollNow ? onRoll : activeIsPilot ? autoPilot?.onTakeControl ?? null : null}
        pressLabel={canRollNow ? "Roll the dice" : "Bot is playing for you — tap to take back control"}
      />
    ) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground width={width} height={height} />
      {/* Centered column on tablet so the board and the corner chips share one
          readable width instead of spanning the whole iPad; full-width on phone. */}
      <ContentColumn style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm, maxWidth: colWidth }}>
        {topBar}
        {notice}

        {railed ? (
          // Board flanked by the two chip columns — each chip stays level with
          // the board corner its yard sits in, so a player still reads as
          // seated where they play. Die and actions go in the rail.
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space.md }}>
            <View style={{ width: CHIP_COLUMN, height: boardSize, justifyContent: "space-between", zIndex: 2 }}>
              {cornerChip(TL, { withDice: false })}
              {cornerChip(BL, { withDice: false })}
            </View>

            {boardWithToast}

            <View style={{ width: CHIP_COLUMN, height: boardSize, justifyContent: "space-between", zIndex: 2 }}>
              {cornerChip(TR, { withDice: false })}
              {cornerChip(BR, { withDice: false })}
            </View>

            <View style={{ flex: 1, minWidth: GAME_RAIL_MIN, alignItems: "center", justifyContent: "center", gap: space.md }}>
              {/* Stretched so the turn message wraps to the rail's width; left
                  to itself under alignItems:center it sizes to its longest line
                  and spills out of the rail. */}
              <View style={{ alignSelf: "stretch" }}>{messageBlock}</View>
              {railDie}
              {actionCluster}
            </View>
          </View>
        ) : (
          <>
            <View style={{ flex: 1, justifyContent: "center" }}>
              {/* Top-of-board profiles (screen corners), then the board, then
                  bottom. zIndex keeps chat bubbles (which pop past the row's
                  bounds toward the board) drawing over the board, not under. */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: space.sm, zIndex: 2 }}>
                {cornerChip(TL)}
                {cornerChip(TR)}
              </View>

              {boardWithToast}

              {/* The local player's yard is bottom-left, so their chip + die live here. */}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginTop: space.sm, zIndex: 2 }}>
                {cornerChip(BL)}
                {cornerChip(BR)}
              </View>
            </View>

            {messageBlock}
            {actionCluster}
          </>
        )}
      </ContentColumn>

      {celebrating && champion && (
        <WinnerCelebration
          winnerName={nameFor?.(champion.id) ?? COLOR_LABEL[champion.color]}
          winnerColor={champion.color}
          winnerAvatar={avatarFor?.(champion.id) ?? null}
          gameOver={finished}
          onSeeResults={finished ? undefined : openStandings}
          pot={pot}
          onStay={() => {
            fromCelebration.current = finished;
            // ONLY once the whole match is over. This sheet also opens for the
            // champion of a 3- or 4-handed game the moment they come home, while
            // everyone else is still walking tokens around the board — and there
            // the button says "Watch the rest", so firing an ad on it dropped a
            // full-screen takeover over a match still in progress and then
            // returned the player to it. An ad may interrupt the end of a game;
            // it may never interrupt the middle of one.
            if (matchOverForSeat({ placed: iFinished }, { finished, intent: "stay" })) {
              void maybeShowEndOfMatchAd();
            }
            setCelebrating(false);
          }}
          onLeave={() => {
            setCelebrating(false);
            // Leaving IS the end of the match for this seat, finished or not.
            void leaveAfterAd();
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
          onSeeResults={openStandings}
          // Staying to watch is mid-match by definition — never an ad here.
          onWatch={() => setFinishPrompt(false)}
          onLeave={() => {
            setFinishPrompt(false);
            // A minor place who has banked their finish and is walking away.
            void leaveAfterAd();
          }}
        />
      )}

      {/* The end-of-match results, or the early read a finished seat asked for.
          Live it drops the rematch controls (there is still a match on) and the
          entry delay (a tapped button has to answer at once); when the match
          does end this same overlay settles into its final form in place. */}
      {((finished && !celebrating) || liveStandings) && (
        <ResultsOverlay
          state={state}
          nameFor={nameFor}
          avatarFor={avatarFor}
          onRematch={finished ? onRematch : undefined}
          rematch={finished ? rematch : undefined}
          footnote={finished ? resultsFootnote : null}
          canAddFriends={!!chat && !chat.reactionsOnly}
          stake={stake}
          live={!finished}
          onBackToGame={() => setStandingsOpen(false)}
          enterDelayMs={fromCelebration.current || liveStandings ? 100 : 900}
          onHome={() => void leaveAfterAd()}
        />
      )}

      {paused && !finished && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onLeave={() => {
            setPaused(false);
            // Same rule: a finished seat walking away may see one, a seat still
            // racing is forfeiting and must not.
            void leaveAfterAd();
          }}
          confirmLeave={confirmLeave}
          // Only a seat still racing has anything to lose: a player who already
          // finished keeps their place in finishedOrder, and the server pays it
          // out when the match ends whether or not they stayed to watch.
          forfeitCoins={stillPlaying ? stake : 0}
          // Already home: the standings are the one thing left to look at, and
          // "Watch the rest" shouldn't have been a one-way door.
          onSeeStandings={iFinished ? openStandings : undefined}
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
          onReport={chat.onReport ?? (() => {})}
          onClose={() => setChatOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * How long this game has been running, in the top bar.
 *
 * The clock keeps ticking on an opponent's turn — it's the match's age, not
 * anybody's shot clock (the turn countdown lives on the active seat's panel) —
 * and stops on the last word of the game so the results screen isn't sitting
 * over a number that's still climbing.
 */
function GameClock({ gameId, running }: { gameId: string; running: boolean }) {
  const startedAt = clockStartFor(gameId);
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt));
  useEffect(() => {
    setSeconds(elapsedSeconds(startedAt));
    if (!running) return;
    // Twice a second: the displayed value floors the real elapsed time, so a
    // 1s interval out of phase with it shows each number up to a second late.
    const id = setInterval(() => setSeconds(elapsedSeconds(startedAt)), 500);
    return () => clearInterval(id);
  }, [startedAt, running]);

  return (
    <View
      accessibilityLabel={`Game time ${formatElapsed(seconds)}`}
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: palette.liftedSlate,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.10)",
      }}
    >
      <Text
        style={{
          fontFamily: font.mono,
          fontSize: 13,
          color: palette.mutedSteel,
          // Digits change every second; a fixed width keeps the pill from
          // twitching as 9→10 or 59→1:00 changes the string's length.
          minWidth: 34,
          textAlign: "center",
        }}
      >
        {formatElapsed(seconds)}
      </Text>
    </View>
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

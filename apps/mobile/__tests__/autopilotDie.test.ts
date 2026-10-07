/**
 * The autopilot must not roll before the die has reached its corner.
 *
 * When the turn passes to the local seat, the die stays beside the opponent who
 * rolled it until their pawn has finished moving (useDieHandover). A player
 * cannot roll during that: the die is not at their corner to tap. The autopilot
 * could — it rolled a fixed PILOT_DELAY after the turn arrived — and when the
 * hold outlasted that, the roll began while the die was still at the opponent's
 * corner. The die then jumped to the local corner as a freshly mounted Dice,
 * which skips a roll it mounts into, so the player's die never tumbled.
 * Reported 2026-09-27: "when bot takes over after being idle the die rolling
 * animation on mine does not show".
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { applyMove, createGame, type GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";

vi.mock("../src/net/api", () => ({
  createGame: vi.fn(),
  joinGame: vi.fn(),
  startGame: vi.fn(),
  newActionId: (() => {
    let n = 0;
    return vi.fn(() => `act-${++n}`);
  })(),
  rollAction: vi.fn(),
  prepareRoll: vi.fn().mockResolvedValue(null),
  moveAction: vi.fn(),
  passAction: vi.fn(),
  timeoutAction: vi.fn(),
  rematchVote: vi.fn(),
  rematchClose: vi.fn(),
  leaveAction: vi.fn().mockResolvedValue(undefined),
  warmUp: vi.fn(),
  getLobby: vi.fn().mockResolvedValue([]),
  lobbyEqual: (a: unknown[], b: unknown[]) =>
    a.length === b.length && a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i])),
  fetchGame: vi.fn(),
  getProfiles: vi.fn().mockResolvedValue([]),
  upsertMyProfile: vi.fn().mockResolvedValue(null),
  setConnected: vi.fn().mockResolvedValue(undefined),
  subscribeGame: vi.fn(),
  unsubscribe: vi.fn(),
  sendChat: vi.fn(),
  TimeoutError: class TimeoutError extends Error {},
  RowGoneError: class RowGoneError extends Error {},
  isTimeout: (e: unknown) => e instanceof Error && e.name === "TimeoutError",
}));

import * as api from "../src/net/api";
import { useOnlineStore } from "../src/store/onlineStore";
import { dieHandoverMs } from "../src/lib/moveTiming";
import { setMeasuredSoundLead } from "../src/lib/soundSync";

const store = useOnlineStore;

const P1 = { id: "p1", userId: "u1", color: "red" as const };
const P2 = { id: "p2", userId: "u2", color: "yellow" as const };

function row(state: GameState, v: number): api.GameRow {
  return {
    id: "g1",
    room_code: "ABCD",
    host_user_id: "u2",
    status: "active",
    state,
    current_turn_player_id: state.currentTurnPlayerId,
    state_version: v,
  };
}

/** The opponent has rolled a five and is about to walk a pawn five cells. */
function opponentAboutToMove(): GameState {
  const base = createGame([P1, P2], { gameId: "g1" });
  return {
    ...base,
    currentTurnPlayerId: "p2",
    phase: "awaiting-move",
    diceValue: 5,
    tokens: base.tokens.map((t) => (t.id === "yellow-0" ? { ...t, position: { type: "track", index: 30 } } : t)),
  };
}

afterEach(() => {
  store.getState().leave();
  setMeasuredSoundLead(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("the autopilot waits for the die", () => {
  it("does not roll until the opponent's die has handed over to this seat", async () => {
    vi.useFakeTimers();
    // A phone whose sound arrives late: the pawn pre-rolls, so a five-cell walk
    // outlasts the autopilot's ordinary pause. (On a Galaxy S26 Ultra the
    // measured lead is ~150ms; this exaggerates it to make the race certain.)
    setMeasuredSoundLead(400);

    const before = opponentAboutToMove();
    let subs: Parameters<typeof api.subscribeGame>[1] | null = null;
    vi.mocked(api.joinGame).mockResolvedValue({ gameId: "g1", roomCode: "ABCD", userId: "u1", myPlayerId: "p1" });
    vi.mocked(api.fetchGame).mockResolvedValue(row(before, 1));
    vi.mocked(api.subscribeGame).mockImplementation((_gameId, handlers) => {
      subs = handlers;
      return {} as RealtimeChannel;
    });
    vi.mocked(api.rollAction).mockReturnValue(new Promise(() => {}));
    await store.getState().join("ABCD");
    store.setState({ autoPilot: true });

    // The opponent's move lands: their pawn walks, and the turn is ours.
    const after = applyMove(before, { tokenId: "yellow-0" });
    expect(after.currentTurnPlayerId).toBe("p1");
    const handover = dieHandoverMs(before, after, null);
    expect(handover).toBeGreaterThan(900); // the case that used to race
    subs!.onGame(row(after, 2));
    await vi.advanceTimersByTimeAsync(0);

    // Past the old fixed pause, but the die is still at the opponent's corner.
    await vi.advanceTimersByTimeAsync(handover - 50);
    expect(api.rollAction).not.toHaveBeenCalled();

    // Once it has arrived — and a beat after — the bot rolls.
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.rollAction).toHaveBeenCalledTimes(1);
  });
});

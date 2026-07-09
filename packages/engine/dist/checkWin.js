import { hasPlayerWon } from "./internal.js";
/**
 * Whether the game is over, and who won (finished first). The game plays to
 * completion: one player finishing does NOT end a 3–4 player game — it ends
 * when all but one have finished (the winner is still whoever finished first).
 * Falls back to token-derived checks so it is correct even for an
 * externally-supplied state that never went through applyMove.
 */
export function checkWin(state) {
    const winner = state.winnerPlayerId ?? state.finishedOrder?.[0] ?? deriveWinner(state);
    if (state.status === "finished") {
        return { finished: true, winnerPlayerId: winner };
    }
    // Derived fallback: the game is over when at most one player is still playing.
    const unfinishedCount = state.players.filter((p) => !hasPlayerWon(state, p.id)).length;
    const finished = state.players.length - unfinishedCount >= Math.max(1, state.players.length - 1);
    return finished ? { finished: true, winnerPlayerId: winner } : { finished: false, winnerPlayerId: winner };
}
function deriveWinner(state) {
    return state.players.find((p) => hasPlayerWon(state, p.id))?.id;
}
//# sourceMappingURL=checkWin.js.map
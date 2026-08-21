/**
 * Capture-risk helpers for the smart policy. Pure functions over the engine's
 * board model, all in ABSOLUTE track space (captures only happen there — yard,
 * home columns and the finish are uncapturable by construction).
 *
 * The dice model is the standard single-die approximation: an opponent token
 * 1–6 cells behind a square hits it with probability 1/6 per roll, so the
 * chance at least one of several stalkers connects is 1 − (5/6)^n. Home-column
 * diverts en route are ignored — close enough for move ranking.
 *
 * Two shapes for every question. The plain functions (threatProb, captureProb)
 * take a state and answer about one square; the `*From` variants take a
 * {@link TrackIndex} built once for the whole position. They are the same
 * arithmetic — the difference is where the scan over tokens happens.
 *
 * That matters because evaluate.ts asks these questions at every leaf of the
 * search, once per token per player. Re-deriving "who is standing where" inside
 * each of those calls turned the contact math into the most expensive thing in
 * the search; building it once per position and reading it O(1) is what keeps
 * both the risk term and the hunt term affordable.
 */
import { absoluteTrackIndex, isSafeSquare, MAIN_TRACK_SIZE, } from "@ludo/engine";
/** Is `abs` a cell where the rules forbid capture? */
function safeCell(state, abs) {
    return state.rules.safeSquares && isSafeSquare(abs);
}
const NO_CELLS = [];
/** Index every token that is actually on the shared track. */
export function buildTrackIndex(state) {
    const ids = [];
    const cells = [];
    for (const t of state.tokens) {
        const abs = absoluteTrackIndex(t.position);
        if (abs === null)
            continue;
        let i = ids.indexOf(t.playerId);
        if (i < 0) {
            i = ids.length;
            ids.push(t.playerId);
            cells.push([]);
        }
        cells[i].push(abs);
    }
    return { ids, cells };
}
/**
 * This player's position in the index, or -1 if they have nothing on the track.
 *
 * Callers in the hot path resolve their slot ONCE and pass the number around,
 * which is the difference between one string lookup per evaluated position and
 * one per token per player per leaf.
 */
export function slotOf(index, playerId) {
    return index.ids.indexOf(playerId);
}
/** The cells at `slot`; empty for -1. */
export function cellsAt(index, slot) {
    return slot < 0 ? NO_CELLS : index.cells[slot];
}
/**
 * Does the owner of `cells` have a protected stack on `abs`? Two of their
 * tokens sharing a cell guard each other, so the square is as good as a star
 * for them — neither a threat to model nor prey worth chasing.
 */
function stackedIn(state, cells, abs) {
    if (!state.rules.protectStacks)
        return false;
    let n = 0;
    for (const c of cells) {
        if (c === abs && ++n >= 2)
            return true;
    }
    return false;
}
/** How many of `cells` are 1–6 behind `abs` — i.e. could land on it next roll. */
function stalkersIn(cells, abs) {
    let n = 0;
    for (const c of cells) {
        const dist = (abs - c + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist >= 1 && dist <= 6)
            n++;
    }
    return n;
}
/** 1 − (5/6)^n: the chance at least one of `n` stalkers connects. */
function hitChance(n) {
    let missAll = 1;
    for (let i = 0; i < n; i++)
        missAll *= 5 / 6;
    return 1 - missAll;
}
/** Opponent track tokens of `playerId` (the only pieces that threaten or flee). */
function opponentTrackTokens(state, playerId) {
    const out = [];
    for (const t of state.tokens) {
        if (t.playerId === playerId)
            continue;
        const abs = absoluteTrackIndex(t.position);
        if (abs !== null)
            out.push({ abs, owner: t.playerId });
    }
    return out;
}
/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export function threatProb(state, playerId, pos) {
    const index = buildTrackIndex(state);
    return threatProbFrom(state, index, slotOf(index, playerId), pos);
}
/** {@link threatProb} against a prebuilt index, for the owner at `ownerSlot`. */
export function threatProbFrom(state, index, ownerSlot, pos) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    return threatProbAt(state, index, ownerSlot, abs);
}
/** {@link threatProb} with the owner's slot and absolute cell already known. */
export function threatProbAt(state, index, ownerSlot, abs) {
    if (safeCell(state, abs))
        return 0;
    // Standing on our own stack is as good as a star — nobody can land here.
    if (stackedIn(state, cellsAt(index, ownerSlot), abs))
        return 0;
    let stalkers = 0;
    for (let i = 0; i < index.cells.length; i++) {
        if (i === ownerSlot)
            continue;
        stalkers += stalkersIn(index.cells[i], abs);
    }
    return hitChance(stalkers);
}
/**
 * Capturable opponent tokens within one roll AHEAD of `pos` — prey a token
 * standing there could hunt next turn. Tokens parked on safe squares don't
 * count, and neither do stacked ones; both are untakeable.
 */
export function chaseCount(state, playerId, pos) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    let n = 0;
    const index = buildTrackIndex(state);
    for (const opp of opponentTrackTokens(state, playerId)) {
        const dist = (opp.abs - abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist < 1 || dist > 6)
            continue;
        if (safeCell(state, opp.abs) || stackedIn(state, cellsAt(index, slotOf(index, opp.owner)), opp.abs))
            continue;
        n++;
    }
    return n;
}
/**
 * Opponent track tokens within `range` cells BEHIND `pos` — traffic that must
 * file past this square soon. A token camped on a safe cell here sits in
 * ambush: the passers-by land in its capture range while it risks nothing.
 */
export function opponentsBehind(state, playerId, pos, range) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    let n = 0;
    for (const opp of opponentTrackTokens(state, playerId)) {
        const dist = (abs - opp.abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
        if (dist >= 1 && dist <= range)
            n++;
    }
    return n;
}
/**
 * Probability that `hunter`'s next roll captures the token `victim` has at
 * `pos`. The exact mirror of {@link threatProb} — same single-die model, same
 * exemptions for safe cells and protected stacks — read from the other side of
 * the board.
 *
 * threatProb answers "what am I about to lose"; this answers "what can I take".
 * A position evaluator needs both, and having only the first is what makes a
 * bot play like it is running a race with the other seats as scenery: it will
 * happily take a capture that falls into its lap, and will never once line one
 * up.
 */
export function captureProb(state, hunter, victim, pos) {
    const index = buildTrackIndex(state);
    return captureProbFrom(state, index, slotOf(index, hunter), victim, pos);
}
/**
 * {@link captureProb} against a prebuilt index.
 *
 * Checks run cheapest-first, and the range test comes before the exemptions on
 * purpose: most opponent tokens are nowhere near a shooter, so the common path
 * is a handful of subtractions and an early return. Only a token actually under
 * the gun pays for the safe-square and stack lookups.
 */
export function captureProbFrom(state, index, hunterSlot, victim, pos) {
    const abs = absoluteTrackIndex(pos);
    if (abs === null)
        return 0;
    return captureProbAt(state, index, hunterSlot, slotOf(index, victim), abs);
}
/**
 * {@link captureProb} with everything already resolved: both slots, and the
 * victim's absolute cell.
 *
 * This is the innermost form, and the evaluator calls it once per token per
 * rival at every leaf — so it deliberately takes what the caller already has
 * rather than re-deriving it. The range test comes first for the same reason:
 * most tokens are nowhere near a shooter, so the common path is a handful of
 * subtractions and an early return, and only a token actually under the gun
 * pays for the safe-square and stack checks.
 */
export function captureProbAt(state, index, hunterSlot, victimSlot, abs) {
    const stalkers = stalkersIn(cellsAt(index, hunterSlot), abs);
    if (stalkers === 0)
        return 0; // nothing in range — no need to ask why not
    if (safeCell(state, abs) || stackedIn(state, cellsAt(index, victimSlot), abs))
        return 0;
    return hitChance(stalkers);
}
//# sourceMappingURL=threat.js.map
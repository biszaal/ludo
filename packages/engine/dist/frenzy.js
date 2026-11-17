import { rollDie } from "./rng.js";
import { getValidMoves } from "./getValidMoves.js";
import { cloneState, inPlayPlayers, makeAction } from "./internal.js";
/**
 * Roll one seat's die in a Frenzy game. There are no turns: a seat in play may
 * roll whenever its die is empty, and there is no three-sixes forfeit because
 * there is no turn to lose. Read {@link getValidMoves} for the seat next; if it
 * is empty, clear the die with {@link frenzyPass}.
 *
 * How soon a seat may roll again (the recharge) is the caller's clock, not a
 * rule of the state. Pure: returns a new state.
 */
export function frenzyRoll(state, playerId, rng, options = {}) {
    const dice = seatDice(state, playerId, "roll");
    if (dice[playerId] !== null) {
        throw new Error("Cannot roll: this seat's die already holds a value.");
    }
    const diceValue = rollDie(rng);
    const next = cloneState(state);
    next.frenzy.dice[playerId] = diceValue;
    next.lastAction = makeAction("roll", { playerId, dice: diceValue }, options.now);
    return { newState: next, diceValue };
}
/**
 * Clear a seat's die after a roll with no legal move — the Frenzy counterpart
 * of {@link endTurn}, with the same guard: you cannot throw a usable roll away.
 * Pure: returns a new state.
 */
export function frenzyPass(state, playerId, options = {}) {
    const dice = seatDice(state, playerId, "pass");
    if (dice[playerId] === null) {
        throw new Error("Cannot pass before rolling.");
    }
    if (getValidMoves(state, playerId).length > 0) {
        throw new Error("Cannot pass while a legal move is available.");
    }
    const next = cloneState(state);
    next.frenzy.dice[playerId] = null;
    next.lastAction = makeAction("endTurn", { playerId }, options.now);
    return next;
}
function seatDice(state, playerId, verb) {
    if (!state.frenzy) {
        throw new Error(`Cannot ${verb}: not a Frenzy game.`);
    }
    if (state.status !== "active") {
        throw new Error(`Cannot ${verb}: game is not active (status: ${state.status}).`);
    }
    if (!inPlayPlayers(state).some((p) => p.id === playerId)) {
        throw new Error(`Cannot ${verb}: ${playerId} is not in play.`);
    }
    return state.frenzy.dice;
}
//# sourceMappingURL=frenzy.js.map
const assert = require("assert");
const { GameLogic } = require("../src/services/game.logic");

console.log("Running Turn Skip Logic Tests...");

const playerRed = {
    userId: "user1",
    color: "red",
    hasCaptured: true,
    tokens: [
        { tokenId: "R1", position: 52, isFinished: false }, // home path position 52
        { tokenId: "R2", position: 999, isFinished: true },
        { tokenId: "R3", position: 999, isFinished: true },
        { tokenId: "R4", position: 999, isFinished: true }
    ]
};

const match = {
    players: [playerRed],
    currentTurn: {
        userId: "user1",
        color: "red",
        diceValues: [5, 1],
        usedDiceIndices: [1] // 1 consumed
    }
};

// 1. Check if 5 is playable for R1 (52 + 5 = 57 -> home!).
assert.strictEqual(GameLogic.hasAnyValidMove(match, playerRed), true, "5 should be valid to reach position 57");

// 2. Overshoot Home (52 + 6 = 58 > 57 -> illegal)
match.currentTurn.diceValues = [6, 1];
match.currentTurn.usedDiceIndices = [1];
assert.strictEqual(GameLogic.hasAnyValidMove(match, playerRed), false, "6 overshoots home (52+6=58), should return false");

// 3. Token locked in base with non-6 dice
const playerLocked = {
    userId: "user2",
    color: "green",
    hasCaptured: false,
    tokens: [
        { tokenId: "G1", position: -1, isFinished: false },
        { tokenId: "G2", position: -1, isFinished: false },
        { tokenId: "G3", position: -1, isFinished: false },
        { tokenId: "G4", position: -1, isFinished: false }
    ]
};

const matchLocked = {
    players: [playerLocked],
    currentTurn: {
        userId: "user2",
        color: "green",
        diceValues: [4, 2],
        usedDiceIndices: []
    }
};

assert.strictEqual(GameLogic.hasAnyValidMove(matchLocked, playerLocked), false, "4,2 rolled with all tokens in base should return false");

// 4. Double Six with all locked tokens
matchLocked.currentTurn.diceValues = [6, 6];
assert.strictEqual(GameLogic.hasAnyValidMove(matchLocked, playerLocked), true, "6,6 rolled with locked tokens should return true (unlock available)");

// ============================================================
// hasCompleteMoveSequence Tests
// ============================================================
console.log("\nRunning hasCompleteMoveSequence Tests...");

// 5. All locked, no six rolled -> no complete sequence
matchLocked.currentTurn.diceValues = [4, 1];
matchLocked.currentTurn.usedDiceIndices = [];
assert.strictEqual(GameLogic.hasCompleteMoveSequence(matchLocked, playerLocked), false, "4,1 with all tokens locked: cannot unlock, no complete sequence");

// 6. All locked, [6,5] -> unlock with 6 (->pos 0), then 5 playable (0+5=5) -> complete sequence
matchLocked.currentTurn.diceValues = [6, 5];
matchLocked.currentTurn.usedDiceIndices = [];
assert.strictEqual(GameLogic.hasCompleteMoveSequence(matchLocked, playerLocked), true, "6,5 with all locked: unlock with 6 then play 5 -> true");

// 7. Single unfinished token in home path (pos 52), others finished. [6,5]:
//    6 overshoots (52+6=58), 5 reaches home (52+5=57) but leaves the 6 unplayable,
//    combined 11 also overshoots -> no complete sequence -> turn should skip
match.currentTurn.diceValues = [6, 5];
match.currentTurn.usedDiceIndices = [];
assert.strictEqual(GameLogic.hasCompleteMoveSequence(match, playerRed), false, "6,5 with single token at 52: 5 reaches home leaving 6 unplayable -> false");

// 8. Token on main board, both dice individually playable in sequence -> true
const playerOnBoard = {
    userId: "user3",
    color: "blue",
    hasCaptured: false,
    tokens: [
        { tokenId: "B1", position: 0, isFinished: false },
        { tokenId: "B2", position: 999, isFinished: true },
        { tokenId: "B3", position: 999, isFinished: true },
        { tokenId: "B4", position: 999, isFinished: true }
    ]
};
const matchOnBoard = {
    players: [playerOnBoard],
    currentTurn: { userId: "user3", color: "blue", diceValues: [2, 3], usedDiceIndices: [] }
};
assert.strictEqual(GameLogic.hasCompleteMoveSequence(matchOnBoard, playerOnBoard), true, "2,3 with token at 0: play 2 then 3 -> true");

// 9. Ensure the in-memory match is not left mutated after the check
assert.deepStrictEqual(match.currentTurn.usedDiceIndices, [], "usedDiceIndices should be restored to [] after check");
assert.strictEqual(playerRed.tokens[0].position, 52, "token position should be restored to 52 after check");

console.log("All hasCompleteMoveSequence Tests Passed!");

console.log("\nAll Turn Skip Logic Tests Passed!");

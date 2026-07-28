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

console.log("All Turn Skip Logic Tests Passed!");

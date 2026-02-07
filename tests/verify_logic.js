const Match = require('../src/models/Match');
const GameLogic = require('../src/services/game.logic');
const mongoose = require('mongoose');

// Mock Data
const player1 = { userId: new mongoose.Types.ObjectId(), color: 'red', tokens: [] };
const player2 = { userId: new mongoose.Types.ObjectId(), color: 'yellow', tokens: [] };

// Helper to create tokens
const createTokens = (color) => [
    { tokenId: `${color[0].toUpperCase()}1`, position: -1, isFinished: false },
    { tokenId: `${color[0].toUpperCase()}2`, position: -1, isFinished: false },
    { tokenId: `${color[0].toUpperCase()}3`, position: -1, isFinished: false },
    { tokenId: `${color[0].toUpperCase()}4`, position: -1, isFinished: false }
];

player1.tokens = createTokens('red');
player2.tokens = createTokens('yellow');

const match = {
    players: [player1, player2],
    currentTurn: {
        userId: player1.userId,
        color: 'red',
        diceValues: [],
        usedDiceIndices: []
    },
    gameType: '1V1'
};

async function testWrapAround() {
    console.log("Testing Wrap Around Logic...");
    const token = player1.tokens[0];
    token.position = 50; // Red Home Entry is 50?
    // Red Start 0. Path 0..51.
    // 50 + 2 = 52 -> 0.

    // Case 1: No Capture -> Should wrap to 0
    player1.hasCaptured = false;
    const isValid = GameLogic.isValidMove(token, 2, player1, match);
    console.log(`isValid(50+2, !captured): ${isValid}`); // Expected: true

    // Simulate apply move logic for position
    let nextPos = 50 + 2;
    if (nextPos > 51) {
        if (!player1.hasCaptured) nextPos = nextPos % 52;
    }
    console.log(`Next Pos (expected 0): ${nextPos}`);

    // Case 2: Captured -> Should Enter Home
    player1.hasCaptured = true;
    nextPos = 50 + 2; // 52
    if (nextPos > 51 && player1.hasCaptured) {
        // Enter Home
    }
    console.log(`Next Pos (expected 52): ${nextPos}`);

    // Case 3: Over-shot Home
    token.position = 56; // One to win
    // Need 1 to go to 57.
    // Roll 2 -> 58 -> Invalid.
    const validHome = GameLogic.isValidMove(token, 2, player1, match);
    console.log(`isValid(56+2, captured): ${validHome}`); // Expected: false
}

testWrapAround();

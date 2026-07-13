const Match = require('../src/models/Match');
const { GameLogic } = require('../src/services/game.logic');
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

    // Case 1: No Capture -> 50 + 2 should be invalid (cannot wrap around)
    token.position = 50;
    player1.hasCaptured = false;
    const isValidInvalidRoll = GameLogic.isValidMove(token, 2, player1, match);
    console.log(`isValid(50+2, !captured): ${isValidInvalidRoll}`); // Expected: false

    const nextPosInvalidRoll = GameLogic.getNextPosition(token, 2, player1.hasCaptured);
    console.log(`Next Pos (expected -1): ${nextPosInvalidRoll}`); // Expected: -1

    // Case 2: No Capture -> 50 + 1 should go to 51 (valid, last stop of home path)
    const isValidValidRoll = GameLogic.isValidMove(token, 1, player1, match);
    console.log(`isValid(50+1, !captured): ${isValidValidRoll}`); // Expected: true

    const nextPosValidRoll = GameLogic.getNextPosition(token, 1, player1.hasCaptured);
    console.log(`Next Pos (expected 51): ${nextPosValidRoll}`); // Expected: 51

    // Case 3: No Capture -> 51 + 1 should be invalid (cannot wrap around from last stop)
    token.position = 51;
    const isValidFromLastStop = GameLogic.isValidMove(token, 1, player1, match);
    console.log(`isValid(51+1, !captured): ${isValidFromLastStop}`); // Expected: false

    const nextPosFromLastStop = GameLogic.getNextPosition(token, 1, player1.hasCaptured);
    console.log(`Next Pos (expected -1): ${nextPosFromLastStop}`); // Expected: -1

    // Case 4: Captured -> Should Enter Home (50 + 2 -> 53)
    token.position = 50;
    player1.hasCaptured = true;
    const isValidCaptured = GameLogic.isValidMove(token, 2, player1, match);
    console.log(`isValid(50+2, captured): ${isValidCaptured}`); // Expected: true

    const nextPosCaptured = GameLogic.getNextPosition(token, 2, player1.hasCaptured);
    console.log(`Next Pos (expected 53): ${nextPosCaptured}`); // Expected: 53

    // Case 5: Over-shot Home
    token.position = 56; // One to win
    // Need 1 to go to 57.
    // Roll 2 -> 58 -> Invalid.
    const validHome = GameLogic.isValidMove(token, 2, player1, match);
    console.log(`isValid(56+2, captured): ${validHome}`); // Expected: false
}

testWrapAround();

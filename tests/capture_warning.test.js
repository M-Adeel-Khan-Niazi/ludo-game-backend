const mongoose = require('mongoose');
const { GameLogic } = require('../src/services/game.logic');

function createPlayer(color, id) {
    const prefix = color[0].toUpperCase();
    return {
        userId: id || new mongoose.Types.ObjectId(),
        color,
        hasCaptured: true,
        status: 'ACTIVE',
        tokens: [
            { tokenId: `${prefix}1`, position: 10, isFinished: false },
            { tokenId: `${prefix}2`, position: -1, isFinished: false },
            { tokenId: `${prefix}3`, position: -1, isFinished: false },
            { tokenId: `${prefix}4`, position: -1, isFinished: false },
        ],
    };
}

function createMatch(red, yellow, diceValues, usedDiceIndices = []) {
    return {
        players: [red, yellow],
        gameType: '1V1',
        currentTurn: {
            userId: red.userId,
            color: 'red',
            diceValues,
            usedDiceIndices,
            rollingPhase: false,
        },
    };
}

function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            passed++;
            console.log(`  PASS: ${message}`);
        } else {
            failed++;
            console.error(`  FAIL: ${message}`);
        }
    }

    console.log('\n1. Second die only enables capture');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        red.tokens[0].position = 8;
        yellow.tokens[0].position = 38;
        const match = createMatch(red, yellow, [2, 4], [0]);
        const warning = GameLogic.getCaptureWarning(match, red);
        assert(warning.capturePossible.secondDie === true, 'second die capture flagged');
        assert(warning.capturePossible.firstDie === false, 'first die already used');
        assert(warning.captureWarning !== null, 'warning message set');
    }

    console.log('\n2. Combined sum enables capture');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        red.tokens[0].position = 5;
        yellow.tokens[0].position = 38;
        const match = createMatch(red, yellow, [3, 4], []);
        const warning = GameLogic.getCaptureWarning(match, red);
        assert(warning.capturePossible.combined === true, 'combined capture detected');
        assert(warning.captureWarning !== null, 'warning for combined');
    }

    console.log('\n3. First die capture on fresh roll');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        red.tokens[0].position = 10;
        yellow.tokens[0].position = 38;
        const match = createMatch(red, yellow, [2, 4], []);
        const warning = GameLogic.getCaptureWarning(match, red);
        assert(warning.capturePossible.firstDie === true, 'first die capture');
        assert(warning.captureWarning !== null, 'warning on first die');
    }

    console.log('\n4. No warning when no capture possible');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        yellow.tokens[0].position = 5;
        const match = createMatch(red, yellow, [1, 2], []);
        const warning = GameLogic.getCaptureWarning(match, red);
        assert(warning.captureWarning === null, 'no warning');
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();

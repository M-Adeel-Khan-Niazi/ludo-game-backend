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
            { tokenId: `${prefix}1`, position: -1, isFinished: false },
            { tokenId: `${prefix}2`, position: -1, isFinished: false },
            { tokenId: `${prefix}3`, position: -1, isFinished: false },
            { tokenId: `${prefix}4`, position: -1, isFinished: false },
        ],
    };
}

function createMatch(players) {
    return {
        players,
        gameType: '1V1',
        state: 'RUNNING',
        currentTurn: {
            userId: players[0].userId,
            color: players[0].color,
            diceValues: [3],
            usedDiceIndices: [],
            rollingPhase: false,
            pendingBonus: false,
            turn: 1,
        },
        markModified() {},
    };
}

function globalFor(color, relativePos) {
    return GameLogic.toGlobalPosition(color, relativePos);
}

function relativeFor(color, globalPos) {
    const offsets = { red: 0, green: 13, yellow: 26, blue: 39 };
    return (globalPos - offsets[color] + 52) % 52;
}

async function runTests() {
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

    // 1. Double lands on double — captures all enemy tokens
    console.log('\n1. Double vs double landing');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        const g = 20;
        red.tokens[0].position = 18;
        red.tokens[1].position = g;
        red.tokens[2].position = g;
        yellow.tokens[0].position = relativeFor('yellow', g);
        yellow.tokens[1].position = relativeFor('yellow', g);
        const match = createMatch([red, yellow]);
        match.currentTurn.userId = red.userId;
        match.currentTurn.color = 'red';
        match.currentTurn.diceValues = [2];

        const result = await GameLogic.applyMove(match, red.userId, 'R1', 0);
        assert(result.captures.length === 2, 'both yellow tokens captured');
        assert(yellow.tokens[0].position === -1 && yellow.tokens[1].position === -1, 'yellow sent home');
        assert(result.bonusReason === 'capture', 'landing capture grants bonus');
    }

    // 2. Single lands on double — no capture
    console.log('\n2. Single vs double landing');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        const g = 20;
        red.tokens[0].position = 18;
        yellow.tokens[0].position = relativeFor('yellow', g);
        yellow.tokens[1].position = relativeFor('yellow', g);
        const match = createMatch([red, yellow]);
        match.currentTurn.diceValues = [2];

        const result = await GameLogic.applyMove(match, red.userId, 'R1', 0);
        assert(result.captures.length === 0, 'no capture for single vs double');
        assert(yellow.tokens[0].position !== -1, 'yellow stack remains');
    }

    // 3. Split double — passive single captures remaining enemy token
    console.log('\n3. Split double departure capture');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        const g = 15;
        red.tokens[0].position = g;
        yellow.tokens[0].position = relativeFor('yellow', g);
        yellow.tokens[1].position = relativeFor('yellow', g);
        const match = createMatch([red, yellow]);
        match.currentTurn.userId = yellow.userId;
        match.currentTurn.color = 'yellow';
        match.currentTurn.diceValues = [3];

        const result = await GameLogic.applyMove(match, yellow.userId, 'Y1', 0);
        assert(result.captures.length === 1, 'one token captured on split');
        assert(yellow.tokens[1].position === -1, 'remaining yellow token captured');
        assert(red.tokens[0].position === g, 'red token stays on cell');
        assert(result.bonusReason !== 'capture' || !match.currentTurn.pendingBonus, 'no bonus for departure-only capture');
    }

    // 4. Safe zone — no capture
    console.log('\n4. Safe zone');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        const g = 0; // safe zone for red start
        red.tokens[0].position = 50;
        red.tokens[1].position = g;
        red.tokens[2].position = g;
        yellow.tokens[0].position = relativeFor('yellow', g);
        yellow.tokens[1].position = relativeFor('yellow', g);
        const match = createMatch([red, yellow]);
        match.currentTurn.diceValues = [2];

        const canCap = GameLogic.checkCapture(match, red, red.tokens[0], 2);
        assert(!canCap, 'checkCapture false in safe zone');
    }

    // 5. checkCapture true for double vs double
    console.log('\n5. checkCapture double vs double');
    {
        const red = createPlayer('red');
        const yellow = createPlayer('yellow');
        const g = 20;
        red.tokens[0].position = 18;
        red.tokens[1].position = g;
        yellow.tokens[0].position = relativeFor('yellow', g);
        yellow.tokens[1].position = relativeFor('yellow', g);
        const match = createMatch([red, yellow]);

        const canCap = GameLogic.checkCapture(match, red, red.tokens[0], 2);
        assert(canCap, 'checkCapture true when mover will form double on enemy double');
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
    console.error(err);
    process.exit(1);
});

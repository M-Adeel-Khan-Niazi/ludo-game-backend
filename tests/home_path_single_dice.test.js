const assert = require('assert');
const mongoose = require('mongoose');
const Match = require('../src/models/Match');
const GameActionService = require('../src/services/gameAction.service');
const { clearTimer } = require('../src/services/timer.service');
const { GameLogic } = require('../src/services/game.logic');

function createPlayer(color, positions, hasCaptured = true) {
    const prefix = color[0].toUpperCase();
    return {
        userId: new mongoose.Types.ObjectId(),
        color,
        hasCaptured,
        status: 'ACTIVE',
        tokens: positions.map((position, index) => ({
            tokenId: `${prefix}${index + 1}`,
            position,
            isFinished: position === GameLogic.STATE_FINISHED,
        })),
    };
}

function createMatch(players, diceValues = [], usedDiceIndices = []) {
    const match = {
        _id: new mongoose.Types.ObjectId(),
        players,
        gameType: '1V1',
        state: 'RUNNING',
        currentTurn: {
            userId: players[0].userId,
            color: players[0].color,
            diceValues,
            usedDiceIndices,
            rollCount: 0,
            rollingPhase: true,
            pendingBonus: 0,
            turn: 1,
            turnDeadline: new Date(Date.now() + 15000),
        },
        markModified() {},
        async save() {
            this.saved = true;
            return this;
        },
    };
    return match;
}

function createIoRecorder() {
    const events = [];
    return {
        events,
        to(roomName) {
            return {
                emit(eventName, payload) {
                    events.push({ roomName, eventName, payload });
                },
            };
        },
    };
}

async function withPatchedRollDice(match, roll, fn) {
    const originalFindById = Match.findById;
    const originalRollDice = GameLogic.rollDice;

    Match.findById = async () => match;
    GameLogic.rollDice = (count) => {
        assert.strictEqual(count, roll.length, 'rollDice receives expected dice count');
        return [...roll];
    };

    try {
        return await fn();
    } finally {
        clearTimer(match._id.toString(), match.currentTurn.turn);
        Match.findById = originalFindById;
        GameLogic.rollDice = originalRollDice;
    }
}

async function runTests() {
    console.log('\nHome-path single-dice and no-move rule');

    {
        const red = createPlayer('red', [52, 999, 999, 999]);
        assert.strictEqual(GameLogic.getDiceCount(red), 1, 'one active home-path token rolls one die');
    }

    {
        const red = createPlayer('red', [52, 53, 55, 56]);
        assert.strictEqual(GameLogic.getDiceCount(red), 1, 'all unfinished tokens in home path roll one die');
    }

    {
        const red = createPlayer('red', [54, 56, 999, 999]);
        assert.strictEqual(GameLogic.getDiceCount(red), 1, 'finished tokens do not block one-die mode');
    }

    {
        const red = createPlayer('red', [-1, 52, 999, 999]);
        assert.strictEqual(GameLogic.getDiceCount(red), 2, 'base token keeps two-dice mode');
    }

    {
        const red = createPlayer('red', [50, 52, 999, 999], false);
        assert.strictEqual(GameLogic.getDiceCount(red), 2, 'pre-home stopped token keeps two-dice mode');
    }

    {
        const red = createPlayer('red', [56, 999, 999, 999]);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow], [2], []);
        match.currentTurn.rollingPhase = false;
        assert.strictEqual(GameLogic.hasAnyValidMove(match, red), false, 'home-path overshoot has no move');
    }

    {
        const red = createPlayer('red', [56, 54, 999, 999]);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow], [3], []);
        match.currentTurn.rollingPhase = false;
        assert.strictEqual(GameLogic.hasAnyValidMove(match, red), true, 'at least one home-path token can move');
    }

    {
        const red = createPlayer('red', [56, 55, 999, 999]);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow], [3], []);
        match.currentTurn.rollingPhase = false;
        assert.strictEqual(GameLogic.hasAnyValidMove(match, red), false, 'all home-path tokens overshoot');
    }

    {
        const red = createPlayer('red', [50, -1, -1, -1], false);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow], [5, 5], []);
        match.currentTurn.rollingPhase = false;
        assert.strictEqual(GameLogic.hasAnyValidMove(match, red), false, 'blocked pre-home token has no 5,5 move');
    }

    {
        const red = createPlayer('red', [50, -1, -1, -1], true);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow], [1], []);
        match.currentTurn.rollingPhase = false;
        assert.strictEqual(GameLogic.isValidMove(red.tokens[0], 1, red, match), true, 'captured player can enter home path from 50');
        assert.strictEqual(GameLogic.getNextPosition(red.tokens[0], 1, true), 52);
    }

    {
        const red = createPlayer('red', [56, 999, 999, 999]);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow]);
        const io = createIoRecorder();

        await withPatchedRollDice(match, [2], async () => {
            const result = await GameActionService.rollDice(io, match._id, red.userId);
            assert.strictEqual(result.hasValidMoves, false, 'rollDice reports no valid moves');
        });

        assert.deepStrictEqual(match.currentTurn.diceValues, [2], 'single-dice mode stores one die');
        assert.strictEqual(match.currentTurn.rollingPhase, false, 'no-move roll stays in move phase until skip timer');
        const remainingMs = match.currentTurn.turnDeadline.getTime() - Date.now();
        assert(remainingMs <= 2100 && remainingMs > 0, 'no-move deadline is about two seconds');

        const diceEvent = io.events.find(e => e.eventName === 'game:diceRolled');
        assert(diceEvent, 'diceRolled event emitted');
        assert.strictEqual(diceEvent.payload.hasValidMoves, false);
        assert.strictEqual(diceEvent.payload.reason, 'no_valid_moves');
        assert.deepStrictEqual(diceEvent.payload.latestRoll, [2]);
    }

    {
        const red = createPlayer('red', [50, 999, 999, 999], false);
        const yellow = createPlayer('yellow', [-1, -1, -1, -1], false);
        const match = createMatch([red, yellow]);
        const io = createIoRecorder();

        await withPatchedRollDice(match, [6, 6], async () => {
            const result = await GameActionService.rollDice(io, match._id, red.userId);
            assert.strictEqual(result.hasValidMoves, false, 'blocked 6,6 reports no valid moves');
        });

        assert.deepStrictEqual(match.currentTurn.diceValues, [6, 6], 'double-six roll is stored');
        assert.strictEqual(match.currentTurn.rollCount, 0, 'blocked 6,6 does not count as bonus double-six roll');
        assert.strictEqual(match.currentTurn.rollingPhase, false, 'blocked 6,6 waits for skip timer');
        const remainingMs = match.currentTurn.turnDeadline.getTime() - Date.now();
        assert(remainingMs <= 2100 && remainingMs > 0, 'blocked 6,6 deadline is about two seconds');

        const diceEvent = io.events.find(e => e.eventName === 'game:diceRolled');
        assert(diceEvent, 'blocked 6,6 diceRolled event emitted');
        assert.strictEqual(diceEvent.payload.hasValidMoves, false);
        assert.strictEqual(diceEvent.payload.canRollAgain, false);
        assert.strictEqual(diceEvent.payload.reason, 'no_valid_moves');
        assert.deepStrictEqual(diceEvent.payload.latestRoll, [6, 6]);
    }

    console.log('  PASS: all home-path single-dice scenarios');
}

runTests().catch((err) => {
    console.error(err);
    process.exit(1);
});

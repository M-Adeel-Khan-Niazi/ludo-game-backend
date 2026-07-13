const { GameLogic } = require('../src/services/game.logic');

function token(position, isFinished = false) {
    return { tokenId: `T${position}`, position, isFinished };
}

function player(tokens) {
    return { tokens };
}

function runTests() {
    let passed = 0;
    let failed = 0;

    function assertEqual(actual, expected, message) {
        if (actual === expected) {
            passed++;
            console.log(`  PASS: ${message}`);
        } else {
            failed++;
            console.error(`  FAIL: ${message} (expected ${expected}, got ${actual})`);
        }
    }

    console.log('\nDice count rules');

    assertEqual(
        GameLogic.getDiceCount(player([
            token(52),
            token(53),
            token(57),
            token(54),
        ])),
        1,
        'single die when all unfinished tokens are in home path'
    );

    assertEqual(
        GameLogic.getDiceCount(player([
            token(52),
            token(53),
            token(57, true),
            token(57, true),
        ])),
        1,
        'single die when remaining unfinished tokens are in home path and others finished'
    );

    assertEqual(
        GameLogic.getDiceCount(player([
            token(52),
            token(57, true),
            token(57, true),
            token(57, true),
        ])),
        1,
        'keeps existing last-token-in-home-path single die rule'
    );

    assertEqual(
        GameLogic.getDiceCount(player([
            token(52),
            token(20),
            token(57, true),
            token(57, true),
        ])),
        2,
        'two dice while any unfinished token remains on the main path'
    );

    assertEqual(
        GameLogic.getDiceCount(player([
            token(52),
            token(-1),
            token(57, true),
            token(57, true),
        ])),
        2,
        'two dice while any unfinished token remains locked in base'
    );

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
}

runTests();

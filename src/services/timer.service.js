const timers = new Map();

function startTimer(io, matchId, turn) {
    const key = `${matchId}-${turn}`;
    
    // [FIX] Prevent duplicates! 
    // If a timer already exists for this specific turn, do not create another one.
    // This fixes the issue where 'game:join' creates extra timers that fire later.
    if (timers.has(key)) {
        // console.log(`Timer already running for ${key}`);
        return; 
    }
    
    const timeout = setTimeout(async () => {
        const { GameLogic } = require('./game.logic');
        const { getMatchLock } = require('../utils/lock');
        const logger = require('../config/logger');

        // [FIX] Use the Lock correctly (Mutex pattern)
        const lock = getMatchLock(matchId);
        
        let release;
        try {
            release = await lock.acquire(); // Wait for lock

            const Match = require('../models/Match');
            const match = await Match.findById(matchId);

            // Double-check turn hasn't changed while waiting for lock
            if (match && match.currentTurn.turn === turn) {
                logger.info(`[Timer] Turn expired for Match: ${matchId}. Switching...`);
                await GameLogic.switchTurn(io, match, logger);
            }
        } catch (error) {
            logger.error('Error in timer callback:', error);
        } finally {
            if (release) release();
            timers.delete(key); // Clean up self
        }
    }, 15000);

    timers.set(key, timeout);
}

function clearTimer(matchId, turn) {
    const key = `${matchId}-${turn}`;
    if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }
}

module.exports = {
    startTimer,
    clearTimer
};
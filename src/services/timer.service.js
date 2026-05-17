const timers = new Map();

/**
 * Build timer payload for client sync (uses persisted turnDeadline).
 */
function getTurnTimerPayload(match) {
    if (!match?.currentTurn?.turnDeadline) return null;

    const turnDeadline = new Date(match.currentTurn.turnDeadline);
    const serverTime = new Date();

    return {
        turn: match.currentTurn.turn,
        turnDeadline: turnDeadline.toISOString(),
        remainingMs: Math.max(0, turnDeadline.getTime() - serverTime.getTime()),
        serverTime: serverTime.toISOString(),
        rollingPhase: match.currentTurn.rollingPhase ?? true,
        currentTurnUserId: match.currentTurn.userId?.toString?.() || String(match.currentTurn.userId),
    };
}

function emitTurnTimerSync(io, target, match, { isYourTurn = null } = {}) {
    const payload = getTurnTimerPayload(match);
    if (!payload) return;

    const event = {
        matchId: match._id.toString(),
        ...payload,
        ...(isYourTurn !== null ? { isYourTurn } : {}),
    };

    if (typeof target === "string") {
        io.to(target).emit("game:turnTimerSync", event);
    } else if (target?.emit) {
        target.emit("game:turnTimerSync", {
            ...event,
            isYourTurn: isYourTurn ?? undefined,
        });
    }
}

function startTimer(io, matchIdRaw, turn) {
    const matchId = matchIdRaw.toString();
    const key = `${matchId}-${turn}`;
    
    // Prevent duplicates
    if (timers.has(key)) {
        return; 
    }

    // Calculate actual remaining time from the DB deadline instead of hardcoded 15s.
    // This prevents drift when there's a gap between setting turnDeadline and calling startTimer.
    const Match = require('../models/Match');
    Match.findById(matchId).then(match => {
        if (!match || !match.currentTurn || match.currentTurn.turn !== turn) return;
        
        // If a timer was created by a concurrent call while we were reading DB, bail out
        if (timers.has(key)) return;

        const deadline = new Date(match.currentTurn.turnDeadline);
        const remaining = deadline.getTime() - Date.now();
        
        // If deadline already passed (or less than 500ms left), fire in 500ms to allow cleanup
        const delay = Math.max(remaining, 500);
        
        const timeout = setTimeout(async () => {
            const { GameLogic } = require('./game.logic');
            const { getMatchLock } = require('../utils/lock');
            const logger = require('../config/logger');

            const lock = getMatchLock(matchId);
            
            let release;
            try {
                release = await lock.acquire();

                const freshMatch = await Match.findById(matchId);

                // Double-check turn hasn't changed while waiting for lock
                if (freshMatch && freshMatch.state === "RUNNING" && freshMatch.currentTurn && freshMatch.currentTurn.turn === turn) {
                    logger.info(`[Timer] Turn expired for Match: ${matchId}, Turn: ${turn}. Switching...`);
                    await GameLogic.switchTurn(io, freshMatch, logger);
                }
            } catch (error) {
                console.error("====== TIMER ERROR ======");
                console.error(error);
                logger.error(`Error in timer callback: ${error.message}`, { stack: error.stack });
            } finally {
                if (release) release();
                timers.delete(key);
            }
        }, delay);

        timers.set(key, timeout);
    }).catch(err => {
        console.error(`[Timer] Failed to read match for deadline: ${err.message}`);
        // Fallback to 15s if DB read fails
        const timeout = setTimeout(async () => {
            const { GameLogic } = require('./game.logic');
            const { getMatchLock } = require('../utils/lock');
            const logger = require('../config/logger');
            const lock = getMatchLock(matchId);
            let release;
            try {
                release = await lock.acquire();
                const Match2 = require('../models/Match');
                const freshMatch = await Match2.findById(matchId);
                if (freshMatch && freshMatch.state === "RUNNING" && freshMatch.currentTurn && freshMatch.currentTurn.turn === turn) {
                    logger.info(`[Timer-Fallback] Turn expired for Match: ${matchId}. Switching...`);
                    await GameLogic.switchTurn(io, freshMatch, logger);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (release) release();
                timers.delete(key);
            }
        }, 15000);
        timers.set(key, timeout);
    });
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
    clearTimer,
    getTurnTimerPayload,
    emitTurnTimerSync,
};
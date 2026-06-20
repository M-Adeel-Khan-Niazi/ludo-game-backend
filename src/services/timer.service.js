const timers = new Map();
const logger = require("../config/logger");

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

function startTimer(io, match, turn) {
    if (!match || !match.currentTurn || match.currentTurn.turn !== turn) return;

    const matchId = match._id.toString();
    const key = `${matchId}-${turn}`;
    
    // Prevent duplicates — clear old timer and restart to ensure freshness
    if (timers.has(key)) {
        const oldTimeout = timers.get(key);
        clearTimeout(oldTimeout);
        timers.delete(key);
        logger.warn(`[Timer] Duplicate key ${key} detected — clearing old timer and restarting`);
    }

    const deadline = new Date(match.currentTurn.turnDeadline);
    const remaining = deadline.getTime() - Date.now();
    
    // If deadline already passed (or less than 500ms left), fire in 500ms to allow cleanup
    const delay = Math.max(remaining, 500);
    
    const timeout = setTimeout(async () => {
        const { GameLogic } = require('./game.logic');
        const { getMatchLock } = require('../utils/lock');
        const logger = require('../config/logger');
        const Match = require('../models/Match');

        const lock = getMatchLock(matchId);
        
        let release;
        try {
            release = await lock.acquire();

            const freshMatch = await Match.findById(matchId);

            // Double-check turn hasn't changed or been extended while waiting for lock
            if (freshMatch && freshMatch.state === "RUNNING" && freshMatch.currentTurn && freshMatch.currentTurn.turn === turn) {
                const freshDeadline = new Date(freshMatch.currentTurn.turnDeadline);
                const freshRemaining = freshDeadline.getTime() - Date.now();

                // If deadline was extended, do not expire the turn
                if (freshRemaining > 500) {
                    logger.info(`[Timer] Turn deadline extended for Match: ${matchId}, Turn: ${turn}. Skipping expiry.`);
                    return;
                }

                logger.info(`[Timer] Turn expired for Match: ${matchId}, Turn: ${turn}. Switching...`);
                await GameLogic.switchTurn(io, freshMatch, logger);
            }
        } catch (error) {
            console.error("====== TIMER ERROR ======");
            console.error(error);
            logger.error(`Error in timer callback: ${error.message}`, { stack: error.stack });
        } finally {
            if (release) release();
            if (timers.get(key) === timeout) {
                timers.delete(key);
            }
        }
    }, delay);

    timers.set(key, timeout);
}

function clearTimer(matchId, turn) {
    const key = `${matchId}-${turn}`;
    if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
    }
}

function isTimerRunning(matchId, turn) {
    const key = `${matchId}-${turn}`;
    return timers.has(key);
}

module.exports = {
    startTimer,
    clearTimer,
    getTurnTimerPayload,
    emitTurnTimerSync,
    isTimerRunning,
};
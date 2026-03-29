const cron = require("node-cron");
const Match = require("../models/Match");
const { GameLogic } = require("../services/game.logic");
const logger = require("../config/logger");
const { getMatchLock } = require("../utils/lock");

// Run every 5 seconds to be responsive
cron.schedule("*/5 * * * * *", async () => {
    try {
        const now = new Date();

        // --- Handle Disconnect Timeouts ---
        const runningMatches = await Match.find({ state: "RUNNING" });
        for (const match of runningMatches) {
            const lock = getMatchLock(match._id.toString());
            const release = await lock.acquire();
            try {
                let changed = false;
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

                for (const player of match.players) {
                    if (player.status === 'DISCONNECTED' && player.disconnectedAt && new Date(player.disconnectedAt) < twoMinutesAgo) {
                        logger.info(`Player ${player.userId} in match ${match._id} disqualified due to 2 min disconnect timeout.`);

                        const MatchService = require('../services/match.service');

                        try {
                            const result = await MatchService.leaveMatch(match._id.toString(), player.userId.toString());

                            if (global.io) {
                                if (result.action === "GAME_ENDED") {
                                    global.io.to(`game:${match._id}`).emit("game:playerLeft", { userId: player.userId, state: "COMPLETED" });
                                    const payload = await GameLogic.getGameOverPayload(match._id.toString(), result.winnerId, result.reason || "Opponent Timed Out", result.winnerAmount);
                                    global.io.to(`game:${match._id}`).emit("game:gameOver", payload);
                                } else if (result.action === "PLAYER_LEFT_GAME") {
                                    global.io.to(`game:${match._id}`).emit("game:playerLeft", { userId: player.userId, state: "RUNNING", status: "DISQUALIFIED" });

                                    if (result.match && result.match.currentTurn && result.match.currentTurn.userId.toString() === player.userId.toString()) {
                                        const { clearTimer } = require('../services/timer.service');
                                        clearTimer(match._id.toString(), result.match.currentTurn.turn);
                                        await GameLogic.switchTurn(global.io, result.match, logger);
                                    }
                                }
                            }
                        } catch (e) {
                            logger.error(`Error kicking player ${player.userId}:`, e);
                        }

                        changed = true;
                        break; // Important: match array might be stale now, move to next tick
                    }
                }

                if (changed) {
                    continue; // Skip the rest of this lock tick, wait for next cron interval
                }
            } catch (e) {
                logger.error(`Cron Disconnect Timeout Error for match ${match._id}:`, e);
            } finally {
                release();
            }
        }


        // Find matches with expired turn deadlines
        const expiredMatches = await Match.find({
            state: "RUNNING",
            "currentTurn.turnDeadline": { $lt: now }
        });

        for (const match of expiredMatches) {
            const lock = getMatchLock(match._id.toString());
            const release = await lock.acquire();
            try {
                // Re-fetch to ensure atomicity
                const FRESH_MATCH = await Match.findById(match._id);
                if (!FRESH_MATCH || FRESH_MATCH.state !== "RUNNING") continue;

                // Double check deadline inside lock
                if (FRESH_MATCH.currentTurn.turnDeadline && new Date(FRESH_MATCH.currentTurn.turnDeadline) < new Date()) {
                    logger.info(`Turn expired for match ${match._id}, switching turn.`);

                    // Switch Turn, passing global io instance
                    if (global.io) {
                        await GameLogic.switchTurn(global.io, FRESH_MATCH, logger);
                    } else {
                        logger.warn(`Cron: global.io not found, cannot emit socket event for match ${match._id}`);
                        // Fallback to old logic maybe? Or just log. For now, just log.
                        // The timer service should handle this anyway. This cron is a fallback.
                    }
                }
            } catch (e) {
                logger.error(`Cron Error for match ${match._id}:`, e);
            } finally {
                release();
            }
        }
    } catch (err) {
        logger.error("Cron Job Error:", err);
    }
});

module.exports = cron;

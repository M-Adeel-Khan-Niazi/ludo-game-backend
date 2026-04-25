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
        const runningMatches = await Match.find({ 
            state: "RUNNING",
            gameType: { $in: ["1V1", "2V2", "4P"] }
        });
        for (const match of runningMatches) {
            const lock = getMatchLock(match._id.toString());
            const release = await lock.acquire();
            try {
                // Re-fetch match inside lock to ensure we have the latest connection status
                const FRESH_MATCH = await Match.findById(match._id);
                if (!FRESH_MATCH || FRESH_MATCH.state !== "RUNNING") continue;

                let changed = false;
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
                const activeCount = FRESH_MATCH.players.filter(p => p.status === 'ACTIVE').length;

                for (const player of FRESH_MATCH.players) {
                    if (player.status === 'DISCONNECTED' && player.disconnectedAt && new Date(player.disconnectedAt) < twoMinutesAgo) {
                        
                        // [RULE] For 4P games, only kick if only 1 player remains active.
                        // If 2 or more are active, we wait for the players to return or for the 1v1/2v2 threshold.
                        if (FRESH_MATCH.gameType === '4P' && activeCount > 1) {
                            continue; 
                        }

                        logger.info(`Player ${player.userId} in match ${FRESH_MATCH._id} (type: ${FRESH_MATCH.gameType}) disqualified due to 2 min disconnect timeout.`);

                        const MatchService = require('../services/match.service');

                        try {
                            const result = await MatchService.leaveMatch(FRESH_MATCH._id.toString(), player.userId.toString());

                            if (global.io) {
                                const roomName = `game:${FRESH_MATCH._id.toString()}`;
                                if (result.action === "GAME_ENDED") {
                                    // 1. Clear Timer
                                    const { clearTimer } = require('../services/timer.service');
                                    if (result.match && result.match.currentTurn) {
                                        clearTimer(FRESH_MATCH._id.toString(), result.match.currentTurn.turn);
                                    }

                                    // 2. Broadcast updated state so everyone's MatchManager is COMPLETED
                                    // Re-fetch populated match to ensure UI has avatars/names for result screen transition
                                    const populatedMatch = await Match.findById(FRESH_MATCH._id).populate({
                                        path: "players.userId",
                                        select: "_id fullName playerStats avatar"
                                    }).populate({
                                        path: "currentTurn.userId",
                                        select: "_id fullName playerStats avatar"
                                    });
                                    global.io.to(roomName).emit("game:state", populatedMatch);

                                    // 3. Notify specific event and payload
                                    global.io.to(roomName).emit("game:playerLeft", { userId: player.userId, state: "COMPLETED" });
                                    const payload = await GameLogic.getGameOverPayload(FRESH_MATCH._id.toString(), result.winnerId, result.reason || "Opponent Timed Out", result.winnerAmount);
                                    global.io.to(roomName).emit("game:gameOver", payload);

                                } else if (result.action === "PLAYER_LEFT_GAME") {
                                    const roomName = `game:${FRESH_MATCH._id.toString()}`;
                                    const populatedMatch = await Match.findById(FRESH_MATCH._id).populate({
                                        path: "players.userId",
                                        select: "_id fullName playerStats avatar"
                                    }).populate({
                                        path: "currentTurn.userId",
                                        select: "_id fullName playerStats avatar"
                                    });
                                    global.io.to(roomName).emit("game:state", populatedMatch);
                                    global.io.to(roomName).emit("game:playerLeft", { userId: player.userId, state: "RUNNING", status: "DISQUALIFIED" });

                                    if (result.match && result.match.currentTurn && result.match.currentTurn.userId.toString() === player.userId.toString()) {
                                        const { clearTimer } = require('../services/timer.service');
                                        clearTimer(FRESH_MATCH._id.toString(), result.match.currentTurn.turn);
                                        await GameLogic.switchTurn(global.io, result.match, logger);
                                    }
                                }
                            }
                        } catch (e) {
                            console.error(`====== ERROR KICKING PLAYER ${player.userId} ======`);
                            console.error(e.stack || e);
                            logger.error(`Error kicking player ${player.userId}: ${e.message || e}`);
                        }

                        changed = true;
                        break; // Important: match array might be stale now, move to next tick
                    }
                }

                if (changed) {
                    continue; // Skip the rest of this lock tick, wait for next cron interval
                }
            } catch (e) {
                console.error("====== CRON TIMEOUT ERROR ======");
                console.error(e.stack || e);
                logger.error(`Cron Disconnect Timeout Error for match ${match._id}: ${e.message || e}`);
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
                if (FRESH_MATCH.currentTurn && FRESH_MATCH.currentTurn.turnDeadline && new Date(FRESH_MATCH.currentTurn.turnDeadline) < new Date()) {
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
                console.error("====== CRON EXPIRED ERROR ======");
                console.error(e.stack || e);
                logger.error(`Cron Error for match ${match._id}: ${e.message || e}`);
            } finally {
                release();
            }
        }
    } catch (err) {
        console.error("====== CRON JOB ROOT ERROR ======");
        console.error(err.stack || err);
        logger.error(`Cron Job Error: ${err.message || err}`);
    }
});

module.exports = cron;

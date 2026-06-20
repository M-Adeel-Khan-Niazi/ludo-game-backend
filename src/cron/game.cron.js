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
                const activeHumanCount = FRESH_MATCH.players.filter(p => p.status === 'ACTIVE' && !p.isBot).length;

                // Check if all humans have left/been disqualified — auto-complete the match
                // (DISCONNECTED is NOT included — players get a 2-minute grace period to reconnect)
                const humanPlayers = FRESH_MATCH.players.filter(p => !p.isBot);
                const allHumansLeftOrDisqualified = humanPlayers.length > 0 && humanPlayers.every(p => ['LEFT', 'DISQUALIFIED'].includes(p.status));
                if (allHumansLeftOrDisqualified) {
                    logger.info(`All humans left/disqualified from match ${FRESH_MATCH._id}. Auto-completing.`);
                    const { clearTimer: clearT } = require('../services/timer.service');
                    clearT(FRESH_MATCH._id.toString(), FRESH_MATCH.currentTurn ? FRESH_MATCH.currentTurn.turn : 0);
                    const BotService = require('../services/bot.service');
                    BotService.cancelPendingBotTurn(FRESH_MATCH._id);

                    const winner = FRESH_MATCH.players.find(p => p.status === 'ACTIVE') || FRESH_MATCH.players.find(p => !['LEFT', 'DISQUALIFIED'].includes(p.status));
                    if (winner) {
                        const MatchService = require('../services/match.service');
                        try {
                            const result = await MatchService.settleGame(FRESH_MATCH, winner.userId);
                            if (global.io) {
                                const roomName = `game:${FRESH_MATCH._id.toString()}`;
                                const payload = await GameLogic.getGameOverPayload(FRESH_MATCH._id.toString(), winner.userId, "ALL_HUMANS_LEFT", result.prize);
                                global.io.to(roomName).emit("game:gameOver", payload);
                                const populatedMatch = await Match.findById(FRESH_MATCH._id).populate({
                                    path: "players.userId",
                                    select: "_id fullName playerStats avatar isBot"
                                }).populate({
                                    path: "currentTurn.userId",
                                    select: "_id fullName playerStats avatar isBot"
                                });
                                global.io.to(roomName).emit("game:state", populatedMatch);
                            }
                        } catch (e) {
                            logger.error(`Error auto-completing match ${FRESH_MATCH._id}: ${e.message}`);
                        }
                    } else {
                        FRESH_MATCH.state = 'ABANDONED';
                        await FRESH_MATCH.save();
                        BotService.cleanupBotUsers(FRESH_MATCH._id).catch(() => {});
                    }
                    changed = true;
                    continue;
                }

                for (const player of FRESH_MATCH.players) {
                    if (player.status === 'DISCONNECTED' && player.disconnectedAt && new Date(player.disconnectedAt) < twoMinutesAgo) {
                        
                        // [RULE] For 4P games, only kick if only 1 human remains active.
                        // If 2+ humans are active, we wait for them to return or for the 1v1/2v2 threshold.
                        // Bots don't count — they're always ACTIVE and shouldn't block human disconnect timeouts.
                        if (FRESH_MATCH.gameType === '4P' && activeHumanCount > 1) {
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
                                    BotService.cleanupBotUsers(FRESH_MATCH._id).catch(() => {});

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


        // --- Handle Stale WAITING Matches (when BOT_ENABLED is false) ---
        const BotService = require('../services/bot.service');
        if (!BotService.isEnabled()) {
            const STALE_THRESHOLD_MS = 3 * 60 * 1000;
            const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
            const staleMatches = await Match.find({
                state: "WAITING",
                isPrivate: false,
                isVsBot: false,
                tournamentId: { $exists: false },
                createdAt: { $lt: staleCutoff }
            });

            for (const match of staleMatches) {
                const lock = getMatchLock(match._id.toString());
                const release = await lock.acquire();
                try {
                    const freshMatch = await Match.findById(match._id);
                    if (!freshMatch || freshMatch.state !== "WAITING") continue;

                    const WalletService = require('../services/wallet.service');
                    for (const p of freshMatch.players) {
                        if (p.isBot) continue;
                        try {
                            await WalletService.cancelGame(p.userId, freshMatch.joiningFee, freshMatch._id);
                        } catch (err) {
                            logger.error(`Error refunding player ${p.userId} on stale match cleanup:`, err.message);
                        }
                    }

                    const botIds = freshMatch.players.filter(p => p.isBot).map(p => p.userId.toString());
                    freshMatch.state = "CANCELLED";
                    await freshMatch.save();
                    await Match.findByIdAndDelete(freshMatch._id);

                    if (global.io) {
                        const roomName = `game:${freshMatch._id}`;
                        global.io.to(roomName).emit("game:matchCancelled", {
                            message: "Match cancelled — no opponents found"
                        });
                        setTimeout(() => {
                            global.io.socketsLeave(roomName);
                        }, 500);
                    }

                    BotService.cleanupBotUsers(freshMatch._id, botIds).catch(() => {});

                    logger.info(`Cleaned up stale WAITING match ${freshMatch._id}`);
                } catch (e) {
                    logger.error(`Error cleaning up stale match ${match._id}:`, e.message);
                } finally {
                    release();
                }
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
                    // Skip if the timer service already has an active timer for this turn
                    const { isTimerRunning } = require('../services/timer.service');
                    if (isTimerRunning(match._id.toString(), FRESH_MATCH.currentTurn.turn)) {
                        logger.info(`Cron: Timer already running for match ${match._id}, turn ${FRESH_MATCH.currentTurn.turn}. Skipping.`);
                        continue;
                    }

                    logger.info(`Turn expired for match ${match._id}, switching turn.`);

                    // Switch Turn, passing global io instance
                    if (global.io) {
                        await GameLogic.switchTurn(global.io, FRESH_MATCH, logger);
                    } else {
                        logger.warn(`Cron: global.io not found, cannot emit socket event for match ${match._id}`);
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

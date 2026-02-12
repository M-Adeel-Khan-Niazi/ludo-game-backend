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
                        player.status = 'LEFT';
                        changed = true;
                        logger.info(`Player ${player.userId} in match ${match._id} marked as LEFT due to disconnect timeout.`);
                        // Note: MatchService.leaveMatch handles settling loss. This is a simplified version.
                    }
                }

                if (changed) {
                    const remainingPlayers = match.players.filter(p => p.status !== 'LEFT' && p.status !== 'DISQUALIFIED');
                    if (remainingPlayers.length === 1) {
                        const winner = remainingPlayers[0];
                        logger.info(`Match ${match._id} ending due to disconnect timeouts. Winner: ${winner.userId}`);
                        const matchService = require('../services/match.service');
                        await matchService.settleGame(match, winner.userId); // This will save the match
                    } else if (remainingPlayers.length === 0) {
                        match.state = 'ABANDONED';
                        logger.info(`Match ${match._id} abandoned as all players timed out.`);
                        await match.save();
                    } else {
                        await match.save();
                    }
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

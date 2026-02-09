const cron = require("node-cron");
const Match = require("../models/Match");
const GameLogic = require("../services/game.logic");
const logger = require("../config/logger");
const { getMatchLock } = require("../utils/lock");

// Run every 5 seconds to be responsive
cron.schedule("*/5 * * * * *", async () => {
    try {
        const now = new Date();
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

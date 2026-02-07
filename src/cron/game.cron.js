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

                    // Switch Turn
                    const nextTurn = await GameLogic.switchTurn(FRESH_MATCH);

                    // We need 'io' to emit... 
                    // This cron service doesn't have access to 'io' easily unless exported or global.
                    // 'server.js' or 'app.js' usually has 'io'.
                    // We can import 'socket.io' instance if it's singleton?
                    // Or we just update DB, and client polls? Client relies on socket.
                    // If we don't emit, clients won't know until they try to move (?)

                    // Ideally, we need 'io'.
                    // In `src/sockets/index.js` or similar, 'io' is initialized.
                    // We can assign `global.io = io` in server.js?
                    if (global.io) {
                        global.io.to(`game:${match._id}`).emit("game:turnChanged", nextTurn);
                        global.io.to(`game:${match._id}`).emit("game:turnExpired", { message: "Turn time expired!" });
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

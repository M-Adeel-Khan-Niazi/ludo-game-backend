const Match = require("../models/Match");
const GameLogic = require("../services/game.logic");
const logger = require("../config/logger");

module.exports = (io, socket) => {

    // Join Game Room
    socket.on("game:join", async ({ matchId }) => {
        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());
            if (!player) return socket.emit("error", { message: "You are not in this match" });

            const roomName = `game:${matchId}`;
            socket.join(roomName);

            socket.emit("game:state", match);
            socket.to(roomName).emit("game:playerJoined", { userId: socket.user._id });

            logger.info(`User ${socket.user._id} joined game ${matchId}`);
        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: "Internal server error" });
        }
    });

    // Roll Dice
    socket.on("game:rollDice", async ({ matchId }) => {
        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });
            if (match.state !== "RUNNING") return socket.emit("error", { message: "Game not running" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString()) {
                return socket.emit("error", { message: "Not your turn" });
            }

            // If already has dice values and not all used, prevent re-roll (unless logic allows?)
            if (match.currentTurn.diceValues && match.currentTurn.diceValues.length > 0 &&
                match.currentTurn.usedDiceIndices.length < match.currentTurn.diceValues.length) {
                return socket.emit("error", { message: "Dice already rolled, please move" });
            }

            const diceValues = GameLogic.rollDice(); // Returns [d1, d2]

            match.currentTurn.diceValues = diceValues;
            match.currentTurn.usedDiceIndices = [];

            // Auto-check moves
            const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());

            // Check valid moves for ANY die
            let hasValidMoves = false;
            diceValues.forEach(val => {
                if (player.tokens.some(t => GameLogic.isValidMove(t, val))) hasValidMoves = true;
            });

            if (!hasValidMoves) {
                // If 2 dice and no moves (e.g. rolled 2,3 and all home), turn lost?
                // Or if one moves, other doesn't?
                // Logic: If NO moves possible for ANY die, turn ends.
                // Standard Ludo: 6 gives turn.
                // If I roll [2, 3] and can't move, turn skipped? Yes.

                await match.save();
                io.to(`game:${matchId}`).emit("game:diceRolled", { userId: socket.user._id, diceValues, hasValidMoves: false });

                setTimeout(async () => {
                    const nextTurn = await GameLogic.switchTurn(match);
                    io.to(`game:${matchId}`).emit("game:turnChanged", nextTurn);
                }, 1000);
                return;
            }

            await match.save();
            io.to(`game:${matchId}`).emit("game:diceRolled", { userId: socket.user._id, diceValues, hasValidMoves: true });

        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: err.message || "Roll Error" });
        }
    });

    // Move Token
    socket.on("game:moveToken", async ({ matchId, tokenId, diceIndex }) => {
        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString()) {
                return socket.emit("error", { message: "Not your turn" });
            }

            if (!match.currentTurn.diceValues || match.currentTurn.diceValues.length === 0) {
                return socket.emit("error", { message: "Roll dice first" });
            }

            // Apply Move
            const result = await GameLogic.applyMove(match, socket.user._id, tokenId, diceIndex);

            // Emit Update
            io.to(`game:${matchId}`).emit("game:tokenMoved", {
                userId: socket.user._id,
                tokenId,
                diceIndex,
                usedDiceValue: match.currentTurn.diceValues[diceIndex],
                newPosition: match.players.find(p => p.userId.toString() === socket.user._id.toString())
                    .tokens.find(t => t.tokenId === tokenId).position,
                captured: result.captured,
                finished: result.finished
            });

            // Check what to do next
            // 1. Are there unused dice?
            const unusedIndices = match.currentTurn.diceValues.map((_, i) => i)
                .filter(i => !match.currentTurn.usedDiceIndices.includes(i));

            if (unusedIndices.length > 0) {
                // Check if remaining dice have valid moves
                const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());
                const remainingHasMoves = unusedIndices.some(idx => {
                    const val = match.currentTurn.diceValues[idx];
                    return player.tokens.some(t => GameLogic.isValidMove(t, val));
                });

                if (remainingHasMoves) {
                    // Continue turn
                    io.to(`game:${matchId}`).emit("game:turnContinued", {
                        userId: socket.user._id,
                        message: "Please use remaining dice"
                    });
                    return;
                } else {
                    // No moves for remaining dice -> End Turn (unless bonus?)
                    // If capturing gave bonus, usually you get NEW ROLL.
                    // But first you must use what you can? 
                    // Let's assume: If you can't move remaining, you lose them. 
                    // AND if you had a bonus pending (from capture/finish/six), you get to roll again?
                    // Simplifying: If no moves for remaining, turn ends or new roll if bonus.
                }
            }

            // If we are here, either all dice used OR remaining dice unusable.

            // Check Bonus for Re-roll
            // If they rolled a 6 (any of the 2 dice?), or captured/finished?
            const rolledSix = match.currentTurn.diceValues.includes(6); // Simplified rule: Any 6 gives bonus?
            // Or only if 6 was used? Usually if you roll 6, you get another turn.

            if (result.bonusTurn || rolledSix) {
                // Bonus!
                // Reset Dice for new roll
                match.currentTurn.diceValues = [];
                match.currentTurn.usedDiceIndices = [];
                await match.save();
                io.to(`game:${matchId}`).emit("game:turnContinued", { userId: socket.user._id, message: "Bonus Turn! Roll again." });
            } else {
                // Switch Turn
                const nextTurn = await GameLogic.switchTurn(match);
                io.to(`game:${matchId}`).emit("game:turnChanged", nextTurn);
            }

        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: err.message || "Move Error" });
        }
    });
};

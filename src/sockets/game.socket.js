const Match = require("../models/Match");
const { GameLogic } = require("../services/game.logic");
const logger = require("../config/logger");
const MatchService = require("../services/match.service");
const { getMatchLock } = require("../utils/lock");
const { startTimer, clearTimer } = require("../services/timer.service");

module.exports = (io, socket) => {

    // Join Game Room
    socket.on("game:join", async ({ matchId }) => {
        try {
            const match = await Match.findById(matchId).populate({
                path: "players.userId",
                select: "_id fullName playerStats avatar"
            }).populate({
                path: "currentTurn.userId",
                select: "_id fullName playerStats avatar"
            });
            if (!match) return socket.emit("error", { message: "Match not found" });

            const player = match.players.find(p => p.userId._id.toString() === socket.user._id.toString());
            if (!player) return socket.emit("error", { message: "You are not in this match" });

            // Note: need to save state
            player.status = "ACTIVE";
            player.disconnectedAt = null;
            await match.save();

            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) {
                socket.join(roomName);
            }

            socket.emit("game:state", match);
            socket.to(roomName).emit("game:playerJoined", {
                userId: socket.user._id,
                avatar: socket.user.avatar,
                fullName: socket.user.fullName
            });

            // Rule 7: Notify when complete/ready. If running, broadcast state to ensure everyone has up-to-date Turn info.
            if (match.state === "RUNNING") {
                io.to(roomName).emit("game:state", match);
                if (match.currentTurn && match.currentTurn.userId) {
                    startTimer(io, matchId, match.currentTurn.turn);
                }
            }

            logger.info(`User ${socket.user._id} joined game ${matchId}`);
        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: "Internal server error" });
        }
    });


    // Leave Game (Rule: Handle creator leave, 1v1 forfeit, etc.)
    socket.on("game:leaveMatch", async ({ matchId }) => {
        try {
            if (!socket.user) return socket.emit("error", { message: "Unauthorized" });

            const result = await MatchService.leaveMatch(matchId, socket.user._id);

            if (result.action === "MATCH_DELETED") {
                // Determine if we should notify specific people.
                // Since match is deleted, room might be just the creator.
                io.to(`game:${matchId}`).emit("game:matchCancelled", { message: "Match cancelled by host" });

                // Force leave room
                const room = io.sockets.adapter.rooms.get(`game:${matchId}`);
                if (room) {
                    // In socket.io v4, we can make sockets leave
                    // But simpler to just let client handle the event
                }
            }
            else if (result.action === "PLAYER_LEFT_LOBBY") {
                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "WAITING" });
                socket.emit("game:left", { message: "You left the lobby" });
                socket.leave(`game:${matchId}`);
            }
            else if (result.action === "GAME_ENDED") {
                // 1v1 Opponent Won
                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "RUNNING" });
                io.to(`game:${matchId}`).emit("game:gameOver", {
                    winnerId: result.winnerId,
                    winningAmount: result.winnerAmount,
                    reason: result.reason || "Opponent surrendered"
                });
                socket.leave(`game:${matchId}`);
            }
            else if (result.action === "PLAYER_LEFT_GAME") {
                // 4P etc
                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "RUNNING" });
                socket.leave(`game:${matchId}`);

                // If it was their turn, switch turn
                const match = result.match;
                if (match && match.currentTurn.userId.toString() === socket.user._id.toString()) {
                    await GameLogic.switchTurn(io, match, logger);
                }
            }

        } catch (err) {
            logger.error("Leave Error:", err);
            socket.emit("error", { message: err.message || "Leave Error" });
        }
    });

    // Chat Message
    socket.on("game:sendMessage", async ({ matchId, type, content }) => {
        try {
            // Verify Match and Player
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            // Check if player is in match
            const isPlayer = match.players.some(p => p.userId.toString() === socket.user._id.toString());
            if (!isPlayer) return socket.emit("error", { message: "Access denied" });

            const ChatMessage = require("../models/ChatMessage");
            const message = await ChatMessage.create({
                matchId,
                sender: socket.user._id,
                type: type || 'text',
                content
            });

            const messageData = {
                _id: message._id,
                sender: {
                    _id: socket.user._id,
                    fullName: socket.user.fullName,
                    avatar: socket.user.avatar
                },
                type: message.type,
                content: message.content,
                createdAt: message.createdAt
            };

            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) {
                socket.join(roomName);
            }

            io.to(roomName).emit("game:messageReceived", messageData);

        } catch (err) {
            logger.error("Chat Error:", err);
            socket.emit("error", { message: "Failed to send message" });
        }
    });

    // Get Chat History
    socket.on("game:getMessages", async ({ matchId, page = 1, limit = 50 }) => {
        try {
            // Verify Match and Player
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            const isPlayer = match.players.some(p => p.userId.toString() === socket.user._id.toString());
            if (!isPlayer) return socket.emit("error", { message: "Access denied" });

            const ChatMessage = require("../models/ChatMessage");

            const messages = await ChatMessage.find({ matchId })
                .populate("sender", "_id fullName avatar")
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit);

            // Reverse to show oldest first if client prefers, or keep as is? 
            // Usually chat history is fetched oldest to newest for display, or newest first for pagination.
            // Let's return as is (descending) and let client reverse, or just return ascending?
            // "sort({ createdAt: -1 })" gives newest first. 
            // If we want history, usually we want "recent 50".

            socket.emit("game:messageHistory", {
                messages: messages
            });

        } catch (err) {
            logger.error("Get Messages Error:", err);
            socket.emit("error", { message: "Failed to fetch messages" });
        }
    });

    // Roll Dice
    socket.on("game:rollDice", async ({ matchId }) => {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });
            if (match.state !== "RUNNING")
                return socket.emit("error", { message: "Game not running" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString())
                return socket.emit("error", { message: "Not your turn" });

            if (!match.currentTurn.rollingPhase)
                return socket.emit("error", { message: "Dice already rolled, please move" });

            clearTimer(matchId, match.currentTurn.turn);

            const latestRoll = GameLogic.rollDice();

            const unusedDice = (match.currentTurn.diceValues || [])
                .filter((_, index) => !match.currentTurn.usedDiceIndices.includes(index));

            match.currentTurn.diceValues = [
                ...unusedDice,
                ...latestRoll
            ];
            match.currentTurn.usedDiceIndices = [];
            match.currentTurn.turnDeadline = new Date(Date.now() + 15000);

            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) socket.join(roomName);

            const isDoubleSix = latestRoll[0] === 6 && latestRoll[1] === 6;

            if (isDoubleSix) {
                match.currentTurn.rollCount++;

                if (match.currentTurn.rollCount >= 3) {
                    await match.save();
                    io.to(roomName).emit("game:diceRolled", {
                        userId: socket.user._id,
                        diceValues: match.currentTurn.diceValues,
                        latestRoll,
                        hasValidMoves: false,
                        canRollAgain: false
                    });
                    await GameLogic.switchTurn(io, match, logger);
                    return;
                }

                await match.save();
                io.to(roomName).emit("game:diceRolled", {
                    userId: socket.user._id,
                    diceValues: match.currentTurn.diceValues,
                    latestRoll,
                    hasValidMoves: true,
                    canRollAgain: true
                });
                startTimer(io, matchId, match.currentTurn.turn);
                return;
            }

            match.currentTurn.rollingPhase = false;

            const player = match.players.find(
                p => p.userId.toString() === socket.user._id.toString()
            );
            const unusedIndices = match.currentTurn.diceValues
                .map((_, i) => i)
                .filter(i => !match.currentTurn.usedDiceIndices.includes(i));

            let hasValidMoves = false;
            unusedIndices.forEach(idx => {
                const val = match.currentTurn.diceValues[idx];
                if (player.tokens.some(t => GameLogic.isValidMove(t, val, player, match)))
                    hasValidMoves = true;
            });

            if (!hasValidMoves) {
                await match.save();
                io.to(roomName).emit("game:diceRolled", {
                    userId: socket.user._id,
                    diceValues: match.currentTurn.diceValues,
                    latestRoll,
                    hasValidMoves: false,
                    canRollAgain: false
                });

                await GameLogic.switchTurn(io, match, logger);
                return;
            }

            await match.save();
            io.to(roomName).emit("game:diceRolled", {
                userId: socket.user._id,
                diceValues: match.currentTurn.diceValues,
                latestRoll,
                hasValidMoves: true,
                canRollAgain: false
            });
            startTimer(io, matchId, match.currentTurn.turn);

        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: err.message || "Roll Error" });
        } finally {
            release();
        }
    });

    // Move Token
    socket.on("game:moveToken", async ({ matchId, tokenId, diceIndex }) => {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString()) {
                return socket.emit("error", { message: "Not your turn" });
            }

            if (match.currentTurn.rollingPhase) {
                return socket.emit("error", { message: "Roll dice first" });
            }

            clearTimer(matchId, match.currentTurn.turn);

            const result = await GameLogic.applyMove(match, socket.user._id, tokenId, diceIndex);

            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) socket.join(roomName);

            if (result.missedTokenId) {
                io.to(roomName).emit("game:tokenGrounded", {
                    userId: socket.user._id,
                    tokenId: result.missedTokenId,
                    message: "Token grounded for missed capture!"
                });
            }

            io.to(roomName).emit("game:tokenMoved", {
                userId: socket.user._id,
                tokenId,
                diceIndex,
                usedDiceValue: match.currentTurn.diceValues[diceIndex],
                newPosition: match.players.find(p => p.userId.toString() === socket.user._id.toString())
                    .tokens.find(t => t.tokenId === tokenId).position,
                captured: result.captured,
                finished: result.finished
            });

            if (result.winnerId) {
                const { prize } = await MatchService.settleGame(match, result.winnerId);
                io.to(roomName).emit("game:gameOver", { winnerId: result.winnerId, prize, reason: "NATURAL_WIN" });
                return;
            }

            if (result.bonusTurn) {
                match.currentTurn.rollingPhase = true;
                match.currentTurn.pendingBonus = false;
                match.currentTurn.turnDeadline = new Date(Date.now() + 15000);
                await match.save();

                const isCapture = !!result.captured;
                const isFinished = !!result.finished;

                let message = "Bonus turn! Roll again...";
                let reason = 'bonus';

                if (isCapture) {
                    message = "Token Captured! Bonus turn! Roll again...";
                    reason = 'capture';
                } else if (isFinished) {
                    message = "Token reached home! Bonus turn! Roll again...";
                    reason = 'home';
                }

                io.to(roomName).emit("game:turnContinued", {
                    userId: socket.user._id,
                    message: message,
                    extraTurn: true,
                    reason: reason
                });
                startTimer(io, matchId, match.currentTurn.turn);
                return;
            }

            const allDiceUsed = result.allDiceUsed;

            if (!allDiceUsed) {
                const unusedIndices = match.currentTurn.diceValues
                    .map((_, i) => i)
                    .filter(i => !match.currentTurn.usedDiceIndices.includes(i));

                const player = match.players.find(
                    p => p.userId.toString() === socket.user._id.toString()
                );
                const remainingHasMoves = unusedIndices.some(idx => {
                    const val = match.currentTurn.diceValues[idx];
                    return player.tokens.some(t =>
                        GameLogic.isValidMove(t, val, player, match)
                    );
                });

                if (remainingHasMoves) {
                    match.currentTurn.turnDeadline = new Date(Date.now() + 15000);
                    await match.save();
                    io.to(roomName).emit("game:turnContinued", {
                        userId: socket.user._id,
                        message: "Please use remaining dice",
                        extraTurn: false,
                        reason: 'continue_move'
                    });
                    startTimer(io, matchId, match.currentTurn.turn);
                    return;
                }
            }

            await GameLogic.switchTurn(io, match, logger);

        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: err.message || "Move Error" });
        } finally {
            release();
        }
    });

    // Disconnect Handling
    socket.on("disconnect", async () => {
        try {
            if (!socket.user) return;
            const userId = socket.user._id.toString();

            const matches = await Match.find({
                "players.userId": userId,
                state: "RUNNING"
            });

            for (const match of matches) {
                const lock = getMatchLock(match._id.toString());
                const release = await lock.acquire();

                try {
                    const player = match.players.find(p => p.userId.toString() === userId);
                    if (player) {
                        player.status = "DISCONNECTED";
                        player.disconnectedAt = new Date();
                        await match.save();

                        io.to(`game:${match._id}`).emit("game:playerDisconnected", { userId, message: "Player disconnected. 2 minutes to rejoin." });

                        if (match.currentTurn.userId.toString() === userId) {
                            clearTimer(match._id, match.currentTurn.turn);
                            await GameLogic.switchTurn(io, match, logger);
                        }
                    }
                } finally { release(); }
            }
        } catch (err) {
            logger.error("Disconnect Error", err);
        }
    });
};

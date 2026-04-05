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

            // Broadcast updated state to everyone in the room so UI stays perfectly in sync (WAITING or RUNNING)
            io.to(roomName).emit("game:state", match);
            
            if (match.state === "RUNNING" && match.currentTurn && match.currentTurn.userId) {
                startTimer(io, matchId, match.currentTurn.turn);
            }

            logger.info(`User ${socket.user._id} joined game ${matchId}`);
        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: "Internal server error" });
        }
    });

    // Get Current Game State (Reconnect / Refresh without side effects)
    socket.on("game:getActiveGameState", async ({ matchId }) => {
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

            // Ensure user is in the socket room for future updates
            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) {
                socket.join(roomName);
            }

            // Update status if they were disconnected (Silent update)
            if (player.status === "DISCONNECTED") {
                player.status = "ACTIVE";
                player.disconnectedAt = null;
                await match.save();
            }

            // Emit state ONLY to the requester
            socket.emit("game:state", match);

            // Ensure timer is running if it's a running game (idempotent check inside startTimer)
            if (match.state === "RUNNING" && match.currentTurn && match.currentTurn.userId) {
                startTimer(io, matchId, match.currentTurn.turn);
            }

        } catch (err) {
            logger.error("GetGameState Error:", err);
            socket.emit("error", { message: "Internal server error" });
        }
    });

    // Host Starts Private Match
    socket.on("game:startPrivate", async ({ matchId }) => {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });
            if (!match.isPrivate) return socket.emit("error", { message: "Not a private match" });
            if (match.state !== "WAITING") return socket.emit("error", { message: "Match already started or ended" });

            // Verify that requester is the host
            const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());
            if (!player || !player.isHost) return socket.emit("error", { message: "Only the host can start the match" });

            if (match.players.length < 2) return socket.emit("error", { message: "Need at least 2 players to start" });

            match.state = "RUNNING";

            // Initialize Turn
            const firstPlayer = match.players.find(p => p.color === "red") || match.players[0];
            match.currentTurn = {
                userId: firstPlayer.userId,
                color: firstPlayer.color,
                diceValues: [],
                usedDiceIndices: [],
                rollCount: 0,
                pendingBonus: false,
                rollingPhase: true,
                turn: 1,
                turnDeadline: new Date(Date.now() + 15000)
            };
            
            await match.save();

            // Re-fetch with populated fields so the UI gets the avatars and names
            const populatedMatch = await Match.findById(matchId).populate({
                path: "players.userId",
                select: "_id fullName playerStats avatar"
            }).populate({
                path: "currentTurn.userId",
                select: "_id fullName playerStats avatar"
            });

            const roomName = `game:${matchId}`;
            io.to(roomName).emit("game:state", populatedMatch);
            
            startTimer(io, matchId, populatedMatch.currentTurn.turn);
        } catch (err) {
            logger.error("Start Private Match Error:", err);
            socket.emit("error", { message: "Failed to start private match" });
        } finally {
            release();
        }
    });

    // Leave Game (Rule: Handle creator leave, 1v1 forfeit, etc.)
    socket.on("game:leaveMatch", async ({ matchId }) => {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();
        try {
            if (!socket.user) return socket.emit("error", { message: "Unauthorized" });

            const result = await MatchService.leaveMatch(matchId, socket.user._id);

            // Silently handle if the match was already deleted by a concurrent request
            if (result.action === "ALREADY_DELETED") {
                socket.leave(`game:${matchId}`);
                return;
            }

            if (result.action === "MATCH_CANCELLED_BY_HOST" || result.action === "MATCH_DELETED") {
                // Emit the cancelled game state so UI can update gracefully
                if (result.match) io.to(`game:${matchId}`).emit("game:state", result.match);
                
                io.to(`game:${matchId}`).emit("game:matchCancelled", { message: "Match cancelled by host" });
                
                // Safely force all connected players to leave the socket room after a short delay
                // to ensure the emit successfully reaches all clients first
                setTimeout(() => {
                    io.socketsLeave(`game:${matchId}`);
                }, 500);
            }
            else if (result.action === "PLAYER_LEFT_LOBBY") {
                // if (result.match) io.to(`game:${matchId}`).emit("game:state", result.match); //comment it later if things go weird
                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "WAITING" });
                socket.emit("game:left", { message: "You left the lobby" });
                socket.leave(`game:${matchId}`);
            }
            else if (result.action === "GAME_ENDED") {
                // 1v1 Opponent Won
                if (result.match && result.match.currentTurn) {
                    clearTimer(matchId, result.match.currentTurn.turn);
                }

                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "COMPLETED" });
                const payload = await GameLogic.getGameOverPayload(matchId, result.winnerId, result.reason || "Opponent Left", result.winnerAmount);
                io.to(`game:${matchId}`).emit("game:gameOver", payload);
                socket.leave(`game:${matchId}`);
            }
            else if (result.action === "PLAYER_LEFT_GAME") {
                // 4P etc
                io.to(`game:${matchId}`).emit("game:playerLeft", { userId: socket.user._id, state: "RUNNING", status: "LEFT" });
                socket.leave(`game:${matchId}`);

                // If it was their turn, switch turn
                const match = result.match;
                if (match && match.currentTurn.userId.toString() === socket.user._id.toString()) {
                    clearTimer(matchId, match.currentTurn.turn);
                    await GameLogic.switchTurn(io, match, logger);
                }
            }

        } catch (err) {
            logger.error("Leave Error:", err);
            socket.emit("error", { message: err.message || "Leave Error" });
        } finally {
            release();
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
            const { cleanMessage } = require("../utils/profanityFilter");
            const cleanContent = type === 'text' ? cleanMessage(content) : content;

            const message = await ChatMessage.create({
                matchId,
                sender: socket.user._id,
                type: type || 'text',
                content: cleanContent
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

            const result = await GameLogic.applyMove(match, socket.user._id, tokenId, diceIndex);

            clearTimer(matchId, match.currentTurn.turn);

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
                const payload = await GameLogic.getGameOverPayload(matchId, result.winnerId, "NATURAL_WIN", prize);
                io.to(roomName).emit("game:gameOver", payload);
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

            if (match.currentTurn.pendingBonus) {
                match.currentTurn.rollingPhase = true;
                match.currentTurn.pendingBonus = false;
                match.currentTurn.usedDiceIndices = [];
                match.currentTurn.diceValues = [];
                match.currentTurn.turnDeadline = new Date(Date.now() + 15000);
                await match.save();

                const reason = result.bonusReason || 'bonus';
                const messages = {
                    capture: "Token Captured! Bonus turn! Roll again...",
                    home: "Token reached home! Bonus turn! Roll again...",
                    bonus: "Bonus turn! Roll again..."
                };

                io.to(roomName).emit("game:turnContinued", {
                    userId: socket.user._id,
                    message: messages[reason] || messages.bonus,
                    extraTurn: true,
                    reason
                });
                startTimer(io, matchId, match.currentTurn.turn);
                return;
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
                    const currentMatch = await Match.findById(match._id);
                    if (!currentMatch || currentMatch.state !== "RUNNING") continue;

                    const player = currentMatch.players.find(p => p.userId.toString() === userId);
                    if (player) {
                        player.status = "DISCONNECTED";
                        player.disconnectedAt = new Date();
                        await currentMatch.save();

                        io.to(`game:${match._id}`).emit("game:playerDisconnected", { userId, message: "Player disconnected. 2 minutes to rejoin." });

                        if (currentMatch.currentTurn.userId.toString() === userId) {
                            clearTimer(currentMatch._id, currentMatch.currentTurn.turn);
                            await GameLogic.switchTurn(io, currentMatch, logger);
                        }
                    }
                } finally { release(); }
            }
        } catch (err) {
            logger.error("Disconnect Error", err);
        }
    });
};

const Match = require("../models/Match");
const GameLogic = require("../services/game.logic");
const logger = require("../config/logger");
const MatchService = require("../services/match.service");
const { getMatchLock } = require("../utils/lock");
const mongoose = require("mongoose");

// Global disconnect timeouts map
const disconnectTimeouts = new Map();

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

            // Clear disconnect timeout if exists
            if (disconnectTimeouts.has(socket.user._id.toString())) {
                clearTimeout(disconnectTimeouts.get(socket.user._id.toString()));
                disconnectTimeouts.delete(socket.user._id.toString());
            }

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
                    reason: "Opponent surrendered"
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
                    const nextTurn = await GameLogic.switchTurn(match);
                    io.to(`game:${matchId}`).emit("game:turnChanged", nextTurn);
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
        if (!mongoose.Types.ObjectId.isValid(matchId)) return socket.emit("error", { message: "Invalid ID" });

        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });
            if (match.state !== "RUNNING") return socket.emit("error", { message: "Game not running" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString()) {
                return socket.emit("error", { message: "Not your turn" });
            }

            // check if already rolled and not used
            if (match.currentTurn.diceValues && match.currentTurn.diceValues.length > 0 &&
                match.currentTurn.usedDiceIndices.length < match.currentTurn.diceValues.length) {
                return socket.emit("error", { message: "Dice already rolled, please move" });
            }

            const diceValues = GameLogic.rollDice(); // Returns [d1, d2]

            match.currentTurn.diceValues = diceValues;
            match.currentTurn.usedDiceIndices = [];

            // Fix 11: Turn Timer (Reset on roll)
            match.currentTurn.turnDeadline = new Date(Date.now() + 15000); // 15s to move

            // Auto-check moves
            const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());
            let hasValidMoves = false;
            diceValues.forEach(val => {
                if (player.tokens.some(t => GameLogic.isValidMove(t, val, player, match))) hasValidMoves = true;
            });

            const roomName = `game:${matchId}`;
            if (!socket.rooms.has(roomName)) socket.join(roomName);

            if (!hasValidMoves) {
                await match.save();
                io.to(roomName).emit("game:diceRolled", { userId: socket.user._id, diceValues, hasValidMoves: false });

                const allTokensHome = player.tokens.every(t => t.position === -1);
                const delay = allTokensHome ? 2000 : 3000; // Faster turn switch

                setTimeout(async () => {
                    // Lock again for switch?
                    // Async flow... tricky inside timeout. 
                    // Best effort:
                    const switchLock = getMatchLock(matchId);
                    const switchRelease = await switchLock.acquire();
                    try {
                        const currentMatch = await Match.findById(matchId);
                        if (!currentMatch || currentMatch.state !== "RUNNING") return;
                        if (currentMatch.currentTurn.userId.toString() === socket.user._id.toString()) {
                            const nextTurn = await GameLogic.switchTurn(currentMatch);
                            io.to(roomName).emit("game:turnChanged", nextTurn);
                        }
                    } finally { switchRelease(); }
                }, delay);
                return;
            }

            await match.save();
            io.to(roomName).emit("game:diceRolled", { userId: socket.user._id, diceValues, hasValidMoves: true });

        } catch (err) {
            logger.error(err);
            socket.emit("error", { message: err.message || "Roll Error" });
        } finally {
            release();
        }
    });

    // Move Token
    socket.on("game:moveToken", async ({ matchId, tokenId, diceIndex }) => {
        if (!mongoose.Types.ObjectId.isValid(matchId)) return socket.emit("error", { message: "Invalid ID" });

        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) return socket.emit("error", { message: "Match not found" });

            if (match.currentTurn.userId.toString() !== socket.user._id.toString()) {
                return socket.emit("error", { message: "Not your turn" });
            }

            // Apply Move
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

            // Emit Update
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

            // Check Win
            if (result.winnerId) {
                const { prize } = await MatchService.settleGame(match, result.winnerId);
                io.to(roomName).emit("game:gameOver", { winnerId: result.winnerId, prize, reason: "NATURAL_WIN" });
                return;
            }

            // Fix 9: Stack limit?
            // Fix 6: Bonus only if used 6
            const usedDiceValue = match.currentTurn.diceValues[diceIndex];
            const rolledSix = usedDiceValue === 6;

            if (result.bonusTurn || rolledSix) {
                // Bonus Logic
                match.currentTurn.rollCount++;

                if (match.currentTurn.rollCount >= 3) {
                    // Too many 6s (or bonuses), forfeit turn? 
                    // Usually only consecutive 6s count. Capture bonus is separate?
                    // Ludo Star: 3 consecutive 6s = forfeit. Capture/Home gives extra turn but doesn't count towards "3x6" penalty?
                    // Let's implement simplistic: 3 consecutive bonus actions = forfeit.
                    const nextTurn = await GameLogic.switchTurn(match);
                    io.to(roomName).emit("game:turnChanged", nextTurn);
                    return;
                }

                // Reset Dice for new roll
                match.currentTurn.diceValues = [];
                match.currentTurn.usedDiceIndices = [];
                // Reset timer for bonus roll
                match.currentTurn.turnDeadline = new Date(Date.now() + 15000);

                await match.save();
                io.to(roomName).emit("game:turnContinued", { userId: socket.user._id, message: "Bonus Turn! Roll again." });
            } else {
                // Check if unused dice exist
                const unusedIndices = match.currentTurn.diceValues.map((_, i) => i)
                    .filter(i => !match.currentTurn.usedDiceIndices.includes(i));

                let remainingHasMoves = false;
                if (unusedIndices.length > 0) {
                    const player = match.players.find(p => p.userId.toString() === socket.user._id.toString());
                    remainingHasMoves = unusedIndices.some(idx => {
                        const val = match.currentTurn.diceValues[idx];
                        return player.tokens.some(t => GameLogic.isValidMove(t, val, player, match));
                    });
                }

                if (remainingHasMoves) {
                    io.to(roomName).emit("game:turnContinued", {
                        userId: socket.user._id,
                        message: "Please use remaining dice"
                    });
                } else {
                    // Switch
                    const nextTurn = await GameLogic.switchTurn(match);
                    io.to(roomName).emit("game:turnChanged", nextTurn);
                }
            }

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
                // Fix 10: Unique timeout key
                const timeoutKey = `${userId}_${match._id}`;

                const lock = getMatchLock(match._id.toString());
                const release = await lock.acquire();

                try {
                    const player = match.players.find(p => p.userId.toString() === userId);
                    if (player) {
                        player.status = "DISCONNECTED";
                        player.disconnectedAt = new Date();
                        await match.save();

                        io.to(`game:${match._id}`).emit("game:playerDisconnected", { userId, message: "Player disconnected. 2 minutes to rejoin." });

                        const timeoutId = setTimeout(async () => {
                            const toLock = getMatchLock(match._id.toString());
                            const toRelease = await toLock.acquire();
                            try {
                                const currentMatch = await Match.findById(match._id);
                                if (!currentMatch || currentMatch.state !== "RUNNING") return;

                                const p = currentMatch.players.find(p => p.userId.toString() === userId);
                                // Check if still disconnected
                                if (p && p.status === "DISCONNECTED") {
                                    p.status = "DISQUALIFIED";
                                    p.tokens.forEach(t => t.position = -1);

                                    await currentMatch.save();
                                    io.to(`game:${match._id}`).emit("game:playerDisqualified", { userId, message: "Player disqualified due to timeout." });

                                    // Check Last Man Standing
                                    const remaining = currentMatch.players.filter(pp => !["LEFT", "DISQUALIFIED", "DISCONNECTED"].includes(pp.status));
                                    // Note: DISCONNECTED players are still theoretically in game until timeout.
                                    // If we have 1 ACTIVE and 1 DISCONNECTED... we wait.
                                    // If we disqualify this one, and only 1 ACTIVE remains? All others are LEFT/DISQ.

                                    // But wait, what if 2 ACTIVE? OK.

                                    const functionalPlayers = currentMatch.players.filter(pp => !["LEFT", "DISQUALIFIED"].includes(pp.status));
                                    // If functional == 1 (The winner).
                                    // Wait, if Disconnected players exist, they are "functional" but offline.
                                    // If I disqualify P1. P2 is Active. P3 is Disconnected (timeout pending).
                                    // functional = [P2, P3]. Length 2. Game continues. Correct.

                                    if (functionalPlayers.length === 1 && currentMatch.players.length > 1) {
                                        const winnerId = functionalPlayers[0].userId;
                                        const { prize } = await MatchService.settleGame(currentMatch, winnerId);
                                        io.to(`game:${match._id}`).emit("game:gameOver", { winnerId, prize, reason: "Last Man Standing" });
                                        return;
                                    }

                                    if (currentMatch.currentTurn.userId.toString() === userId) {
                                        const nextTurn = await GameLogic.switchTurn(currentMatch);
                                        io.to(`game:${match._id}`).emit("game:turnChanged", nextTurn);
                                    }
                                }
                            } catch (e) { logger.error("Timeout Error", e); }
                            finally { toRelease(); }
                        }, 2 * 60 * 1000);

                        disconnectTimeouts.set(timeoutKey, timeoutId);
                    }
                } finally { release(); }
            }
        } catch (err) {
            logger.error("Disconnect Error", err);
        }
    });
};

const Match = require("../models/Match");
const { GameLogic } = require("../services/game.logic");
const logger = require("../config/logger");
const MatchService = require("../services/match.service");
const GameActionService = require("../services/gameAction.service");
const BotService = require("../services/bot.service");
const { getMatchLock } = require("../utils/lock");
const {
  startTimer,
  clearTimer,
  getTurnTimerPayload,
  emitTurnTimerSync,
} = require("../services/timer.service");

module.exports = (io, socket) => {
  // Join Game Room
  socket.on("game:join", async ({ matchId }) => {
    try {
      let match = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar isBot",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar isBot",
        });
      if (!match) return socket.emit("error", { message: "Match not found" });

      const player = match.players.find(
        (p) => p.userId._id.toString() === socket.user._id.toString()
      );
      if (!player)
        return socket.emit("error", { message: "You are not in this match" });

      let wasDisconnected = false;
      if (player.status === "DISCONNECTED" && match.state === "RUNNING") {
        const updateResult = await Match.updateOne(
          { _id: matchId, "players.userId": socket.user._id, "players.status": "DISCONNECTED", state: "RUNNING" },
          { $set: { "players.$.status": "ACTIVE", "players.$.disconnectedAt": null } }
        );
        wasDisconnected = updateResult.modifiedCount > 0;
        if (wasDisconnected) {
          match = await Match.findById(matchId)
            .populate({
              path: "players.userId",
              select: "_id fullName playerStats avatar isBot",
            })
            .populate({
              path: "currentTurn.userId",
              select: "_id fullName playerStats avatar isBot",
            });
        }
      }

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) {
        socket.join(roomName);
      }

      socket.emit("game:state", match);
      if (wasDisconnected) {
        io.to(roomName).emit("game:playerReconnected", {
          userId: socket.user._id,
          avatar: socket.user.avatar,
          fullName: socket.user.fullName,
        });
      } else {
        socket.to(roomName).emit("game:playerJoined", {
          userId: socket.user._id,
          avatar: socket.user.avatar,
          fullName: socket.user.fullName,
        });
      }

      io.to(roomName).emit("game:state", match);

      if (match.state === "RUNNING" && match.currentTurn?.userId) {
        startTimer(io, match, match.currentTurn.turn);
        BotService.onTurnChanged(io, matchId);
        const isYourTurn =
          match.currentTurn.userId._id?.toString() ===
          socket.user._id.toString() ||
          match.currentTurn.userId.toString() === socket.user._id.toString();
        emitTurnTimerSync(io, socket, match, { isYourTurn });
        emitTurnTimerSync(io, roomName, match);
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
      let match = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar isBot",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar isBot",
        });

      if (!match) return socket.emit("error", { message: "Match not found" });

      const player = match.players.find(
        (p) => p.userId._id.toString() === socket.user._id.toString()
      );
      if (!player)
        return socket.emit("error", { message: "You are not in this match" });

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) {
        socket.join(roomName);
      }

      const wasDisconnected =
        player.status === "DISCONNECTED" && match.state === "RUNNING";
      if (wasDisconnected) {
        const updateResult = await Match.updateOne(
          { _id: matchId, "players.userId": socket.user._id, "players.status": "DISCONNECTED", state: "RUNNING" },
          { $set: { "players.$.status": "ACTIVE", "players.$.disconnectedAt": null } }
        );
        if (updateResult.modifiedCount > 0) {
          io.to(roomName).emit("game:playerReconnected", {
            userId: socket.user._id,
          });
          match = await Match.findById(matchId)
            .populate({
              path: "players.userId",
              select: "_id fullName playerStats avatar isBot",
            })
            .populate({
              path: "currentTurn.userId",
              select: "_id fullName playerStats avatar isBot",
            });
        }
      }

      socket.emit("game:state", match);

      // --- CATCH MISSED GAME OVER ---
      // If the match ended while they were offline, emit the results so their UI transitions.
      if (match.state === "COMPLETED") {
        const payload = await GameLogic.getGameOverPayload(
          match._id,
          match.winner,
          "Match Finished",
          match.winningAmount
        );
        socket.emit("game:gameOver", payload);
        return;
      }

      if (match.state === "RUNNING" && match.currentTurn?.userId) {
        startTimer(io, match, match.currentTurn.turn);
        const isYourTurn =
          match.currentTurn.userId._id?.toString() ===
          socket.user._id.toString() ||
          match.currentTurn.userId.toString() === socket.user._id.toString();
        emitTurnTimerSync(io, socket, match, { isYourTurn });
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
      if (!match.isPrivate)
        return socket.emit("error", { message: "Not a private match" });
      if (match.state !== "WAITING")
        return socket.emit("error", {
          message: "Match already started or ended",
        });

      // Verify that requester is the host
      const player = match.players.find(
        (p) => p.userId.toString() === socket.user._id.toString()
      );
      if (!player || !player.isHost)
        return socket.emit("error", {
          message: "Only the host can start the match",
        });

      if (match.players.length < 2)
        return socket.emit("error", {
          message: "Need at least 2 players to start",
        });

      match.state = "RUNNING";

      // Initialize Turn
      const firstPlayer =
        match.players.find((p) => p.color === "red") || match.players[0];
      match.currentTurn = {
        userId: firstPlayer.userId,
        color: firstPlayer.color,
        diceValues: [],
        usedDiceIndices: [],
        rollCount: 0,
        pendingBonus: 0,
        rollingPhase: true,
        turn: 1,
        turnDeadline: new Date(Date.now() + 60000),
      };

      await match.save();

      // Re-fetch with populated fields so the UI gets the avatars and names
      const populatedMatch = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar isBot",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar isBot",
        });

      const roomName = `game:${matchId}`;
      io.to(roomName).emit("game:state", populatedMatch);

      startTimer(io, populatedMatch, populatedMatch.currentTurn.turn);
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
      if (!socket.user)
        return socket.emit("error", { message: "Unauthorized" });

      const result = await MatchService.leaveMatch(matchId, socket.user._id);

      // Silently handle if the match was already deleted by a concurrent request
      if (result.action === "ALREADY_DELETED") {
        socket.leave(`game:${matchId}`);
        return;
      }

      if (
        result.action === "MATCH_CANCELLED_BY_HOST" ||
        result.action === "MATCH_DELETED"
      ) {
        // Emit the cancelled game state so UI can update gracefully
        if (result.match)
          io.to(`game:${matchId}`).emit("game:state", result.match);

        io.to(`game:${matchId}`).emit("game:matchCancelled", {
          message: "Match cancelled by host",
        });

        BotService.cleanupBotUsers(matchId, result.botIds).catch(() => { });

        // Safely force all connected players to leave the socket room after a short delay
        // to ensure the emit successfully reaches all clients first
        setTimeout(() => {
          io.socketsLeave(`game:${matchId}`);
        }, 500);
      } else if (result.action === "PLAYER_LEFT_LOBBY") {
        // if (result.match) io.to(`game:${matchId}`).emit("game:state", result.match); //comment it later if things go weird
        io.to(`game:${matchId}`).emit("game:playerLeft", {
          userId: socket.user._id,
          state: "WAITING",
        });
        socket.emit("game:left", { message: "You left the lobby" });
        socket.leave(`game:${matchId}`);
      } else if (result.action === "GAME_ENDED") {
        const roomName = `game:${matchId}`;
        if (result.match && result.match.currentTurn) {
          clearTimer(matchId, result.match.currentTurn.turn);
        }

        // Broadcast populated state so the opponent's UI has names/avatars for the result screen
        try {
          const populatedMatch = await Match.findById(matchId)
            .populate({
              path: "players.userId",
              select: "_id fullName playerStats avatar isBot",
            })
            .populate({
              path: "currentTurn.userId",
              select: "_id fullName playerStats avatar isBot",
            });
          io.to(roomName).emit("game:state", populatedMatch || result.match);
        } catch (popErr) {
          logger.error(
            "Failed to populate match for leave broadcast:",
            popErr.message
          );
          io.to(roomName).emit("game:state", result.match);
        }

        io.to(roomName).emit("game:playerLeft", {
          userId: socket.user._id,
          state: "COMPLETED",
        });

        try {
          const payload = await GameLogic.getGameOverPayload(
            matchId,
            result.winnerId,
            result.reason || "Opponent Left",
            result.winnerAmount
          );
          if (payload) {
            io.to(roomName).emit("game:gameOver", payload);
          } else {
            logger.error(
              `[LeaveMatch] getGameOverPayload returned null for match ${matchId}`
            );
          }
        } catch (payloadErr) {
          logger.error(
            `[LeaveMatch] Error generating gameOver payload for match ${matchId}:`,
            payloadErr.message
          );
        }

        socket.leave(roomName);
        BotService.cleanupBotUsers(matchId).catch(() => { });
      } else if (result.action === "PLAYER_LEFT_GAME") {
        // 4P etc
        io.to(`game:${matchId}`).emit("game:playerLeft", {
          userId: socket.user._id,
          state: "RUNNING",
          status: "LEFT",
        });
        socket.leave(`game:${matchId}`);

        // If it was their turn, switch turn
        const match = result.match;
        if (
          match &&
          match.currentTurn.userId.toString() === socket.user._id.toString()
        ) {
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
      const isPlayer = match.players.some(
        (p) => p.userId.toString() === socket.user._id.toString()
      );
      if (!isPlayer) return socket.emit("error", { message: "Access denied" });

      const ChatMessage = require("../models/ChatMessage");
      const { cleanMessage } = require("../utils/profanityFilter");
      const cleanContent = type === "text" ? cleanMessage(content) : content;

      const message = await ChatMessage.create({
        matchId,
        sender: socket.user._id,
        type: type || "text",
        content: cleanContent,
      });

      const messageData = {
        _id: message._id,
        sender: {
          _id: socket.user._id,
          fullName: socket.user.fullName,
          avatar: socket.user.avatar,
        },
        type: message.type,
        content: message.content,
        createdAt: message.createdAt,
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

      const isPlayer = match.players.some(
        (p) => p.userId.toString() === socket.user._id.toString()
      );
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
        messages: messages,
      });
    } catch (err) {
      logger.error("Get Messages Error:", err);
      socket.emit("error", { message: "Failed to fetch messages" });
    }
  });

  // Roll Dice — delegates to GameActionService (lock-protected)
  socket.on("game:rollDice", async ({ matchId }) => {
    try {
      // Restore connection status before rolling (outside lock is fine — lock is inside rollDice)
      const match = await Match.findById(matchId);
      if (!match) return socket.emit("error", { message: "Match not found" });
      const player = match.players.find(
        (p) => p.userId.toString() === socket.user._id.toString()
      );
      if (player && player.status === "DISCONNECTED") {
        const updateResult = await Match.updateOne(
          { _id: matchId, "players.userId": socket.user._id, "players.status": "DISCONNECTED", state: "RUNNING" },
          { $set: { "players.$.status": "ACTIVE", "players.$.disconnectedAt": null } }
        );
        if (updateResult.modifiedCount > 0) {
          const roomName = `game:${matchId}`;
          io.to(roomName).emit("game:playerReconnected", {
            userId: socket.user._id,
            avatar: socket.user.avatar,
            fullName: socket.user.fullName,
          });
        }
      }

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) socket.join(roomName);

      const result = await GameActionService.rollDice(io, matchId, socket.user._id);

      if (result.switchedTurn) {
        // Turn was switched (no valid moves, double-6 x3) — nothing else to do
      }
    } catch (err) {
      logger.error(err);
      socket.emit("error", { message: err.message || "Roll Error" });
    }
  });

  // Move Token — delegates to GameActionService (lock-protected)
  socket.on("game:moveToken", async ({ matchId, tokenId, diceIndex }) => {
    try {
      // Restore connection status before moving
      const match = await Match.findById(matchId);
      if (!match) return socket.emit("error", { message: "Match not found" });
      const movingPlayer = match.players.find(
        (p) => p.userId.toString() === socket.user._id.toString()
      );
      if (movingPlayer && movingPlayer.status === "DISCONNECTED") {
        const updateResult = await Match.updateOne(
          { _id: matchId, "players.userId": socket.user._id, "players.status": "DISCONNECTED", state: "RUNNING" },
          { $set: { "players.$.status": "ACTIVE", "players.$.disconnectedAt": null } }
        );
        if (updateResult.modifiedCount > 0) {
          const roomName = `game:${matchId}`;
          io.to(roomName).emit("game:playerReconnected", {
            userId: socket.user._id,
            avatar: socket.user.avatar,
            fullName: socket.user.fullName,
          });
        }
      }

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) socket.join(roomName);

      await GameActionService.moveToken(io, matchId, socket.user._id, tokenId, diceIndex);
    } catch (err) {
      logger.error(err);
      socket.emit("error", { message: err.message || "Move Error" });
    }
  });

  // Disconnect Handling
  socket.on("disconnect", async () => {
    try {
      if (!socket.user) return;
      const userId = socket.user._id.toString();

      const matches = await Match.find({
        "players.userId": userId,
        state: "RUNNING",
      });

      for (const match of matches) {
        try {
          const updateResult = await Match.updateOne(
            {
              _id: match._id,
              "players.userId": userId,
              state: "RUNNING",
              "players.status": { $ne: "DISCONNECTED" },
            },
            {
              $set: {
                "players.$.status": "DISCONNECTED",
                "players.$.disconnectedAt": new Date(),
              },
            }
          );

          if (updateResult.modifiedCount > 0) {
            const updatedMatch = await Match.findById(match._id);
            const roomName = `game:${match._id}`;
            const isCurrentTurn =
              updatedMatch?.currentTurn?.userId?.toString() === userId;
            const turnTimer = getTurnTimerPayload(updatedMatch);

            io.to(roomName).emit("game:playerDisconnected", {
              userId,
              message: isCurrentTurn
                ? "Player disconnected. Turn timer still running — rejoin before it expires."
                : "Player disconnected. 2 minutes to rejoin.",
              isCurrentTurn,
              turnTimer,
            });
          }
        } catch (err) {
          logger.error(`Disconnect updateOne error for match ${match._id}:`, err.message);
        }
      }
    } catch (err) {
      logger.error("Disconnect Error", err);
    }
  });
};

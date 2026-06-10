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

function restorePlayerConnection(match, player) {
  const wasDisconnected = player.status === "DISCONNECTED";
  player.status = "ACTIVE";
  player.disconnectedAt = null;
  return wasDisconnected;
}

module.exports = (io, socket) => {
  // Join Game Room
  socket.on("game:join", async ({ matchId }) => {
    try {
      const match = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar",
        });
      if (!match) return socket.emit("error", { message: "Match not found" });

      const player = match.players.find(
        (p) => p.userId._id.toString() === socket.user._id.toString()
      );
      if (!player)
        return socket.emit("error", { message: "You are not in this match" });

      const wasDisconnected = restorePlayerConnection(match, player);
      await match.save();

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
      const match = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar",
        });

      if (!match) return socket.emit("error", { message: "Match not found" });

      const player = match.players.find(
        (p) => p.userId._id.toString() === socket.user._id.toString()
      );
      if (!player)
        return socket.emit("error", { message: "You are not in this match" });

      // Ensure user is in the socket room for future updates
      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) {
        socket.join(roomName);
      }

      const wasDisconnected =
        player.status === "DISCONNECTED" && match.state === "RUNNING";
      if (wasDisconnected) {
        restorePlayerConnection(match, player);
        await match.save();
        io.to(roomName).emit("game:playerReconnected", {
          userId: socket.user._id,
        });
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
        turnDeadline: new Date(Date.now() + 15000),
      };

      await match.save();

      // Re-fetch with populated fields so the UI gets the avatars and names
      const populatedMatch = await Match.findById(matchId)
        .populate({
          path: "players.userId",
          select: "_id fullName playerStats avatar",
        })
        .populate({
          path: "currentTurn.userId",
          select: "_id fullName playerStats avatar",
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
              select: "_id fullName playerStats avatar",
            })
            .populate({
              path: "currentTurn.userId",
              select: "_id fullName playerStats avatar",
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

  // Roll Dice
  socket.on("game:rollDice", async ({ matchId }) => {
    try {
      const match = await Match.findById(matchId);
      if (!match) return socket.emit("error", { message: "Match not found" });
      if (match.state !== "RUNNING")
        return socket.emit("error", { message: "Game not running" });

      if (match.currentTurn.userId.toString() !== socket.user._id.toString())
        return socket.emit("error", { message: "Not your turn" });

      if (!match.currentTurn.rollingPhase)
        return socket.emit("error", {
          message: "Dice already rolled, please move",
        });

      clearTimer(matchId, match.currentTurn.turn);

      const player = match.players.find(
        (p) => p.userId.toString() === socket.user._id.toString()
      );

      if (player && player.status === "DISCONNECTED") {
        restorePlayerConnection(match, player);
        const roomName = `game:${matchId}`;
        io.to(roomName).emit("game:playerReconnected", {
          userId: socket.user._id,
          avatar: socket.user.avatar,
          fullName: socket.user.fullName,
        });
      }

      const diceCount = GameLogic.getDiceCount(player);
      const latestRoll = GameLogic.rollDice(diceCount);

      const unusedDice = (match.currentTurn.diceValues || []).filter(
        (_, index) => !match.currentTurn.usedDiceIndices.includes(index)
      );

      match.currentTurn.diceValues = [...unusedDice, ...latestRoll];
      match.currentTurn.usedDiceIndices = [];
      match.currentTurn.turnDeadline = new Date(Date.now() + 15000);

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) socket.join(roomName);

      const isDoubleSix = latestRoll[0] === 6 && latestRoll[1] === 6;

      if (isDoubleSix) {
        match.currentTurn.rollCount++;

        if (match.currentTurn.rollCount >= 3) {
          match.currentTurn.turnDeadline = new Date(Date.now() + 2000);
          await match.save();
          io.to(roomName).emit("game:diceRolled", {
            userId: socket.user._id,
            diceValues: match.currentTurn.diceValues,
            latestRoll,
            hasValidMoves: false,
            canRollAgain: false,
            turnDeadline: match.currentTurn.turnDeadline,
          });
          startTimer(io, match, match.currentTurn.turn);
          return;
        }

        await match.save();
        io.to(roomName).emit("game:diceRolled", {
          userId: socket.user._id,
          diceValues: match.currentTurn.diceValues,
          latestRoll,
          hasValidMoves: true,
          canRollAgain: true,
          turnDeadline: match.currentTurn.turnDeadline,
        });
        startTimer(io, match, match.currentTurn.turn);
        return;
      }

      match.currentTurn.rollingPhase = false;

      const unusedIndices = match.currentTurn.diceValues
        .map((_, i) => i)
        .filter((i) => !match.currentTurn.usedDiceIndices.includes(i));

      const hasValidMoves = GameLogic.hasAnyValidMove(match, player);

      if (!hasValidMoves) {
        match.currentTurn.turnDeadline = new Date(Date.now() + 2000);
        await match.save();
        io.to(roomName).emit("game:diceRolled", {
          userId: socket.user._id,
          diceValues: match.currentTurn.diceValues,
          latestRoll,
          hasValidMoves: false,
          canRollAgain: false,
          turnDeadline: match.currentTurn.turnDeadline,
        });

        startTimer(io, match, match.currentTurn.turn);
        return;
      }

      let captureWarning = null;
      let capturePossible = {
        firstDie: false,
        secondDie: false,
        combined: false,
      };
      try {
        const warningInfo = GameLogic.getCaptureWarning(match, player);
        captureWarning = warningInfo.captureWarning;
        capturePossible = warningInfo.capturePossible;
      } catch (e) {
        logger.error("Error checking for capture warning:", e);
      }

      await match.save();
      io.to(roomName).emit("game:diceRolled", {
        userId: socket.user._id,
        diceValues: match.currentTurn.diceValues,
        latestRoll,
        hasValidMoves: true,
        canRollAgain: false,
        captureWarning,
        capturePossible,
        turnDeadline: match.currentTurn.turnDeadline,
      });
      startTimer(io, match, match.currentTurn.turn);
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

      if (match.currentTurn.rollingPhase) {
        return socket.emit("error", { message: "Roll dice first" });
      }

      const movingPlayer = match.players.find(
        (p) => p.userId.toString() === socket.user._id.toString()
      );

      if (movingPlayer && movingPlayer.status === "DISCONNECTED") {
        restorePlayerConnection(match, movingPlayer);
        const roomName = `game:${matchId}`;
        io.to(roomName).emit("game:playerReconnected", {
          userId: socket.user._id,
          avatar: socket.user.avatar,
          fullName: socket.user.fullName,
        });
      }

      const result = await GameLogic.applyMove(
        match,
        socket.user._id,
        tokenId,
        diceIndex
      );

      await match.save();

      clearTimer(matchId, match.currentTurn.turn);

      const roomName = `game:${matchId}`;
      if (!socket.rooms.has(roomName)) socket.join(roomName);

      if (result.missedTokenId) {
        io.to(roomName).emit("game:tokenGrounded", {
          userId: socket.user._id,
          tokenId: result.missedTokenId,
          message: "Token grounded for missed capture!",
        });
      }

      io.to(roomName).emit("game:tokenMoved", {
        userId: socket.user._id,
        tokenId,
        diceIndex,
        usedDiceValue: match.currentTurn.diceValues[diceIndex],
        newPosition: match.players
          .find((p) => p.userId.toString() === socket.user._id.toString())
          .tokens.find((t) => t.tokenId === tokenId).position,
        captured: result.captured,
        captures: result.captures || (result.captured ? [result.captured] : []),
        finished: result.finished,
        players: match.players.map((p) => ({
          userId: p.userId,
          hasCaptured: p.hasCaptured,
          tokens: p.tokens.map((t) => ({
            tokenId: t.tokenId,
            position: t.position,
            isFinished: t.isFinished,
          })),
        })),
      });

      if (result.winnerId) {
        const { prize } = await MatchService.settleGame(match, result.winnerId);
        const payload = await GameLogic.getGameOverPayload(
          matchId,
          result.winnerId,
          "NATURAL_WIN",
          prize
        );
        io.to(roomName).emit("game:gameOver", payload);
        return;
      }

      const allDiceUsed = result.allDiceUsed;

      if (!allDiceUsed) {
        const unusedIndices = match.currentTurn.diceValues
          .map((_, i) => i)
          .filter((i) => !match.currentTurn.usedDiceIndices.includes(i));

        const player = match.players.find(
          (p) => p.userId.toString() === socket.user._id.toString()
        );
        const remainingHasMoves = GameLogic.hasAnyValidMove(match, player);

        if (remainingHasMoves) {
          match.currentTurn.turnDeadline = new Date(Date.now() + 15000);
          await match.save();

          let captureWarning = null;
          let capturePossible = {
            firstDie: false,
            secondDie: false,
            combined: false,
          };
          try {
            const warningInfo = GameLogic.getCaptureWarning(match, player);
            captureWarning = warningInfo.captureWarning;
            capturePossible = warningInfo.capturePossible;
          } catch (e) {
            logger.error("Error checking capture warning on turnContinued:", e);
          }

          io.to(roomName).emit("game:turnContinued", {
            userId: socket.user._id,
            message: "Please use remaining dice",
            extraTurn: false,
            reason: "continue_move",
            captureWarning,
            capturePossible,
            pendingBonus: match.currentTurn.pendingBonus,
            turnDeadline: match.currentTurn.turnDeadline,
          });
          startTimer(io, match, match.currentTurn.turn);
          return;
        }
      }

      if (match.currentTurn.pendingBonus > 0) {
        match.currentTurn.rollingPhase = true;
        match.currentTurn.pendingBonus -= 1;
        match.currentTurn.usedDiceIndices = [];
        match.currentTurn.diceValues = [];
        match.currentTurn.turnDeadline = new Date(Date.now() + 15000);
        await match.save();

        const reason = result.bonusReason || "bonus";
        const messages = {
          capture: "Token Captured! Bonus turn! Roll again...",
          home: "Token reached home! Bonus turn! Roll again...",
          bonus: "Bonus turn! Roll again...",
        };

        io.to(roomName).emit("game:turnContinued", {
          userId: socket.user._id,
          message: messages[reason] || messages.bonus,
          extraTurn: true,
          reason,
          pendingBonus: match.currentTurn.pendingBonus,
          turnDeadline: match.currentTurn.turnDeadline,
        });
        startTimer(io, match, match.currentTurn.turn);
        return;
      }

      await GameLogic.switchTurn(io, match, logger);
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
        const lock = getMatchLock(match._id.toString());
        const release = await lock.acquire();

        try {
          const currentMatch = await Match.findById(match._id);
          if (!currentMatch || currentMatch.state !== "RUNNING") continue;

          const player = currentMatch.players.find(
            (p) => p.userId.toString() === userId
          );
          if (player) {
            player.status = "DISCONNECTED";
            player.disconnectedAt = new Date();
            await currentMatch.save();

            const roomName = `game:${currentMatch._id}`;
            const isCurrentTurn =
              currentMatch.currentTurn?.userId?.toString() === userId;
            const turnTimer = getTurnTimerPayload(currentMatch);

            io.to(roomName).emit("game:playerDisconnected", {
              userId,
              message: isCurrentTurn
                ? "Player disconnected. Turn timer still running — rejoin before it expires."
                : "Player disconnected. 2 minutes to rejoin.",
              isCurrentTurn,
              turnTimer,
            });

            // Do NOT clear the turn timer or switch turn on brief disconnect.
            // Turn expiry is handled by timer.service + game.cron via turnDeadline.
            // Long absence is handled by game.cron.js (2 min disconnect disqualification).
          }
        } finally {
          release();
        }
      }
    } catch (err) {
      logger.error("Disconnect Error", err);
    }
  });
};

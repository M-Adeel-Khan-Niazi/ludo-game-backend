const Match = require("../models/Match");
const { GameLogic } = require("./game.logic");
const MatchService = require("./match.service");
const { getMatchLock } = require("../utils/lock");
const { startTimer, clearTimer } = require("./timer.service");
const logger = require("../config/logger");

/**
 * Server-side game actions (used by sockets and bot AI).
 */
class GameActionService {
    async rollDice(io, matchId, userId) {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) throw new Error("Match not found");
            if (match.state !== "RUNNING") throw new Error("Game not running");

            if (match.currentTurn.userId.toString() !== userId.toString()) {
                throw new Error("Not your turn");
            }

            if (!match.currentTurn.rollingPhase) {
                throw new Error("Dice already rolled, please move");
            }

            clearTimer(matchId, match.currentTurn.turn);

            const player = match.players.find(
                (p) => p.userId.toString() === userId.toString()
            );
            const diceCount = GameLogic.getDiceCount(player);
            const latestRoll = GameLogic.rollDice(diceCount);

            const unusedDice = (match.currentTurn.diceValues || []).filter(
                (_, index) => !match.currentTurn.usedDiceIndices.includes(index)
            );

            match.currentTurn.diceValues = [...unusedDice, ...latestRoll];
            match.currentTurn.usedDiceIndices = [];
            match.currentTurn.turnDeadline = new Date(Date.now() + 60000);

            const roomName = `game:${matchId}`;
            const isDoubleSix = latestRoll[0] === 6 && latestRoll[1] === 6;

            if (isDoubleSix) {
                match.currentTurn.rollCount++;

                if (match.currentTurn.rollCount >= 3) {
                    match.currentTurn.turnDeadline = new Date(Date.now() + 2000);
                    await match.save();
                    io.to(roomName).emit("game:diceRolled", {
                        userId,
                        diceValues: match.currentTurn.diceValues,
                        latestRoll,
                        hasValidMoves: false,
                        canRollAgain: false,
                        turnDeadline: match.currentTurn.turnDeadline,
                    });
                    startTimer(io, match, match.currentTurn.turn);
                    return { match, switchedTurn: true };
                }

                // Check if the doubled sixes can actually be played (complete sequence).
                // Current mechanic discards the sixes and grants a re-roll; we only allow
                // that re-roll if there is at least one playable sequence. Otherwise the
                // turn is skipped (2s display + switchTurn) so the player isn't stranded.
                const dsHasSequence = GameLogic.hasCompleteMoveSequence(match, player);
                await match.save();

                if (!dsHasSequence) {
                    match.currentTurn.turnDeadline = new Date(Date.now() + 2000);
                    await match.save();
                    io.to(roomName).emit("game:diceRolled", {
                        userId,
                        diceValues: match.currentTurn.diceValues,
                        latestRoll,
                        hasValidMoves: false,
                        canRollAgain: false,
                        turnDeadline: match.currentTurn.turnDeadline,
                    });
                    startTimer(io, match, match.currentTurn.turn);
                    return { match, hasValidMoves: false };
                }

                io.to(roomName).emit("game:diceRolled", {
                    userId,
                    diceValues: match.currentTurn.diceValues,
                    latestRoll,
                    hasValidMoves: true,
                    canRollAgain: true,
                    turnDeadline: match.currentTurn.turnDeadline,
                });
                startTimer(io, match, match.currentTurn.turn);
                return { match, canRollAgain: true };
            }

            match.currentTurn.rollingPhase = false;

            const hasCompleteSequence = GameLogic.hasCompleteMoveSequence(match, player);

            if (!hasCompleteSequence) {
                // No sequence of moves can consume all the rolled dice. Skip the entire
                // turn, but defer the switch by 2s so the client shows the rolled dice
                // and the unused-dice panel before the turn changes.
                // Note: diceValues is kept populated and usedDiceIndices stays [] (reset
                // earlier) so the client displays the rolled numbers like a normal roll.
                match.currentTurn.turnDeadline = new Date(Date.now() + 2000);
                await match.save();
                io.to(roomName).emit("game:diceRolled", {
                    userId,
                    diceValues: match.currentTurn.diceValues,
                    latestRoll,
                    hasValidMoves: false,
                    canRollAgain: false,
                    turnDeadline: match.currentTurn.turnDeadline,
                });
                startTimer(io, match, match.currentTurn.turn);
                return { match, hasValidMoves: false };
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
                userId,
                diceValues: match.currentTurn.diceValues,
                latestRoll,
                hasValidMoves: true,
                canRollAgain: false,
                captureWarning,
                capturePossible,
                turnDeadline: match.currentTurn.turnDeadline,
            });
            startTimer(io, match, match.currentTurn.turn);
            return { match, hasValidMoves: true };
        } finally {
            release();
        }
    }

    async moveToken(io, matchId, userId, tokenId, diceIndex) {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match) throw new Error("Match not found");

            if (match.currentTurn.userId.toString() !== userId.toString()) {
                throw new Error("Not your turn");
            }

            if (match.currentTurn.rollingPhase) {
                throw new Error("Roll dice first");
            }

            const result = await GameLogic.applyMove(match, userId, tokenId, diceIndex);

            clearTimer(matchId, match.currentTurn.turn);

            const roomName = `game:${matchId}`;

            if (result.missedTokenId) {
                io.to(roomName).emit("game:tokenGrounded", {
                    userId,
                    tokenId: result.missedTokenId,
                    message: "Token grounded for missed capture!",
                });
            }

            io.to(roomName).emit("game:tokenMoved", {
                userId,
                tokenId,
                diceIndex,
                usedDiceValue: match.currentTurn.diceValues[diceIndex],
                newPosition: match.players
                    .find((p) => p.userId.toString() === userId.toString())
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
                let prize = 0;
                try {
                    const settled = await MatchService.settleGame(match, result.winnerId);
                    prize = settled.prize;
                } catch (settleErr) {
                    logger.error(`settleGame failed on natural win for match ${matchId}:`, settleErr);
                    match.state = "COMPLETED";
                    match.winner = result.winnerId;
                    await match.save();
                }
                const payload = await GameLogic.getGameOverPayload(
                    matchId,
                    result.winnerId,
                    "NATURAL_WIN",
                    prize
                );
                io.to(roomName).emit("game:gameOver", payload);
                return { match, gameOver: true, winnerId: result.winnerId };
            }

            const allDiceUsed = result.allDiceUsed;

            if (!allDiceUsed) {
                const player = match.players.find(
                    (p) => p.userId.toString() === userId.toString()
                );
                const remainingHasMoves = GameLogic.hasAnyValidMove(match, player);

                if (remainingHasMoves) {
                    match.currentTurn.turnDeadline = new Date(Date.now() + 60000);
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
                        userId,
                        message: "Please use remaining dice",
                        extraTurn: false,
                        reason: "continue_move",
                        captureWarning,
                        capturePossible,
                        pendingBonus: match.currentTurn.pendingBonus,
                        turnDeadline: match.currentTurn.turnDeadline,
                    });
                    startTimer(io, match, match.currentTurn.turn);
                    return { match, continueMove: true };
                }
            }

            if (match.currentTurn.pendingBonus > 0) {
                match.currentTurn.rollingPhase = true;
                match.currentTurn.pendingBonus -= 1;
                match.currentTurn.usedDiceIndices = [];
                match.currentTurn.diceValues = [];
                match.currentTurn.turnDeadline = new Date(Date.now() + 60000);
                await match.save();

                const reason = result.bonusReason || "bonus";
                const messages = {
                    capture: "Token Captured! Bonus turn! Roll again...",
                    home: "Token reached home! Bonus turn! Roll again...",
                    bonus: "Bonus turn! Roll again...",
                };

                io.to(roomName).emit("game:turnContinued", {
                    userId,
                    message: messages[reason] || messages.bonus,
                    extraTurn: true,
                    reason,
                    pendingBonus: match.currentTurn.pendingBonus,
                    turnDeadline: match.currentTurn.turnDeadline,
                });
                startTimer(io, match, match.currentTurn.turn);
                return { match, bonusTurn: true };
            }

            try {
                await GameLogic.switchTurn(io, match, logger);
            } catch (switchErr) {
                logger.error(`switchTurn failed after moveToken in match ${matchId}:`, switchErr);
                try {
                    const freshMatch = await Match.findById(matchId);
                    if (freshMatch && freshMatch.state === "RUNNING" && freshMatch.currentTurn) {
                        freshMatch.currentTurn.turnDeadline = new Date(Date.now() + 3000);
                        await freshMatch.save();
                        startTimer(io, freshMatch, freshMatch.currentTurn.turn);
                        logger.info(`Fallback timer started for match ${matchId} after switchTurn failure`);
                    }
                } catch (fallbackErr) {
                    logger.error(`Fallback timer also failed for match ${matchId}:`, fallbackErr);
                }
            }
            return { match, switchedTurn: true };
        } finally {
            release();
        }
    }
}

module.exports = new GameActionService();

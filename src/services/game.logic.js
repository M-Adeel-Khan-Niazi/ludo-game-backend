class GameLogic {
    constructor() {
        // Game Constants
        this.PATH_LENGTH = 52; // Main board path steps (0-51)
        this.HOME_PATH_LENGTH = 6; // Steps to reach home center (52-57)
        this.TOTAL_STEPS = this.PATH_LENGTH + this.HOME_PATH_LENGTH; // 58 steps total

        // Token States
        this.STATE_HOME = -1; // In base
        this.STATE_FINISHED = 999; // Reached end

        // Safe Zones (Global Indices on main path)
        this.SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];

        // Test flag: Ensures the first roll of the server instance is always 6,6
        // this.isFirstRoll = true;
    }

    /**
     * Roll 2 dice
     */
    rollDice(count = 2) {
        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * 6) + 1);
        }
        return rolls;
    }

    /**
     * Determine how many dice a player should roll
     */
    getDiceCount(player) {
        if (!player || !player.tokens) return 2;

        const finishedTokens = player.tokens.filter(t => t.isFinished);
        const activeTokens = player.tokens.filter(t => !t.isFinished);

        // Rule: Only one dice if only 1 token left, it's in home path, and rest finished
        if (finishedTokens.length === 3 && activeTokens.length === 1) {
            const lastToken = activeTokens[0];
            if (lastToken.position >= 52 && lastToken.position <= 57) {
                return 1;
            }
        }
        return 2;
    }

    /**
     * Check if player's captured status should be reset
     */
    checkAndResetCaptured(player) {
        if (!player || !player.tokens) return;

        // Set false if all 4 tokens are back to home
        // (Note: This automatically handles the "if any finished" rule because finished tokens are not at position -1)
        const allAtHome = player.tokens.every(t => t.position === this.STATE_HOME);
        if (allAtHome) {
            player.hasCaptured = false;
        }
    }

    /**
     * Get the next turn color
     */
    getNextTurnColor(currentMatch) {
        // Custom Turn Order: Red -> Yellow -> Green -> Blue
        const colors = ['red', 'yellow', 'green', 'blue'];
        const activePlayers = currentMatch.players
            .filter(p => p.status === 'ACTIVE' || p.status === 'DISCONNECTED')
            .sort((a, b) => colors.indexOf(a.color) - colors.indexOf(b.color));

        if (activePlayers.length === 0) return null;

        const currentIndex = activePlayers.findIndex(
            p => p.color === currentMatch.currentTurn.color
        );

        const nextIndex = (currentIndex + 1) % activePlayers.length;
        return activePlayers[nextIndex];
    }

    /**
     * Calculate global position for collision detection
     */
    toGlobalPosition(color, relativePos) {
        if (relativePos === -1 || relativePos > 51) return null; // Home or Safe Home Path

        let offset = 0;
        if (color === 'green') offset = 13;
        if (color === 'yellow') offset = 26;
        if (color === 'blue') offset = 39;

        return (relativePos + offset) % 52;
    }

    getNextPosition(token, diceValue, hasCaptured) {
        if (token.position === this.STATE_HOME) {
            return diceValue === 6 ? 0 : -1;
        }
        let nextPos = token.position + diceValue;
        if (hasCaptured) {
            if (token.position <= 50 && nextPos > 50) {
                nextPos += 1;
            } else if (token.position <= 51 && nextPos > 51) {
                nextPos = nextPos % 52;
            }
        } else {
            if (nextPos > 51) {
                nextPos = nextPos % 52;
            }
        }
        return nextPos;
    }


    /**
     * Helper: Check if a global position has a Double (2+ tokens of same color)
     */
    isDouble(match, globalPos, excludeColor) {
        for (const p of match.players) {
            if (p.color === excludeColor) continue;

            const tokensAtPos = p.tokens.filter(t => {
                if (t.position === -1 || t.isFinished || t.position > 51) return false;
                const gPos = this.toGlobalPosition(p.color, t.position);
                return gPos === globalPos;
            });

            if (tokensAtPos.length >= 2) return true;
        }
        return false;
    }

    isValidMove(token, diceValue, player, match) {
        if (token.isFinished) return false;

        // Priority Rule: If player has an unused 6 and locked tokens, they MUST unlock first.
        if (match && match.currentTurn && match.currentTurn.diceValues && match.currentTurn.usedDiceIndices) {
            const hasUnusedSix = match.currentTurn.diceValues.some((val, idx) => 
                val === 6 && !match.currentTurn.usedDiceIndices.includes(idx)
            );
            const hasLockedTokens = player.tokens.some(t => t.position === this.STATE_HOME);

            if (hasUnusedSix && hasLockedTokens) {
                if (diceValue !== 6 || token.position !== this.STATE_HOME) {
                    return false; // Prevent any other move while forced to unlock
                }
            }
        }

        // Rule 1: Must open with 6
        if (token.position === this.STATE_HOME) {
            return diceValue === 6;
        }

        let potentialPos = this.getNextPosition(token, diceValue, player.hasCaptured);
        if (potentialPos > 57) return false; // Exact throw needed

        // Rule 3: Double Protection (No single coin can hit double coin)
        // Correction: Move is SAFE, not INVALID. You can land on double, just not capture.
        // So we do NOT return false here.

        return true;
    }

    /**
     * Helper: Check if a move would result in a capture
     */
    checkCapture(match, player, token, diceValue) {
        if (token.position === this.STATE_HOME && diceValue !== 6) return false;
        if (token.position === this.STATE_HOME && diceValue === 6) {
            return false; // Safe exit
        }

        let potentialPos = this.getNextPosition(token, diceValue, player.hasCaptured);
        if (potentialPos > 51) return false; // In safe zone/home path

        const globalDest = this.toGlobalPosition(player.color, potentialPos);
        if (this.SAFE_ZONES.includes(globalDest)) return false;

        // Check for enemies
        for (const p of match.players) {
            if (p.userId.toString() === player.userId.toString()) continue;

            // Check doubles logic here:
            // If enemy has double at destination -> NO Capture.
            if (this.isDouble(match, globalDest, player.color)) return false;

            for (const t of p.tokens) {
                if (t.position === -1 || t.isFinished || t.position > 51) continue;
                const gPos = this.toGlobalPosition(p.color, t.position);
                if (gPos === globalDest) return true;
            }
        }
        return false;
    }

    /**
     * Check if the current player can capture any opponent token with the available unused dice.
     */
    isCapturePossible(match, player, unusedIndices) {
        if (!match || !player || !unusedIndices || !match.currentTurn || !match.currentTurn.diceValues) {
            return false;
        }

        for (const idx of unusedIndices) {
            const diceValue = match.currentTurn.diceValues[idx];
            for (const token of player.tokens) {
                if (token.isFinished) continue;
                if (this.isValidMove(token, diceValue, player, match)) {
                    if (this.checkCapture(match, player, token, diceValue)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    async applyMove(match, userId, tokenId, diceIndex) {
        const player = match.players.find(p => p.userId.toString() === userId.toString());
        if (!player) throw new Error("Player not found");
        if (match.currentTurn.userId.toString() !== userId.toString()) throw new Error("Not your turn");

        const token = player.tokens.find(t => t.tokenId === tokenId);
        if (!token) throw new Error("Token not found");
        const wasHome = (token.position === this.STATE_HOME);

        if (match.currentTurn.usedDiceIndices.includes(diceIndex)) throw new Error("Dice already used");

        const diceValue = match.currentTurn.diceValues[diceIndex];

        // Explicit Error check to provide meaningful feedback to the player
        const hasUnusedSix = match.currentTurn.diceValues.some((val, idx) => 
            val === 6 && !match.currentTurn.usedDiceIndices.includes(idx)
        );
        const hasLockedTokens = player.tokens.some(t => t.position === this.STATE_HOME);

        if (hasUnusedSix && hasLockedTokens) {
            if (diceValue !== 6 || token.position !== this.STATE_HOME) {
                throw new Error("Please unlock your tokens first");
            }
        }

        if (!this.isValidMove(token, diceValue, player, match)) throw new Error("Invalid move");

        // Rule 4: Forced Hit (Huff) Check logic
        let missedTokenId = null;
        // Check if ANY other token could have captured with THIS dice
        for (const t of player.tokens) {
            if (t.isFinished || t.tokenId === tokenId) continue;

            if (this.isValidMove(t, diceValue, player, match) && this.checkCapture(match, player, t, diceValue)) {
                // 't' could have captured.
                // Did the chosen move capture?
                if (!this.checkCapture(match, player, token, diceValue)) {
                    // Missed opportunity!
                    missedTokenId = t.tokenId;
                }
            }
        }

        // Apply Penalty if missed
        if (missedTokenId) {
            const groundedToken = player.tokens.find(t => t.tokenId === missedTokenId);
            if (groundedToken) {
                groundedToken.position = -1;
                this.checkAndResetCaptured(player);
            }
        }

        // Execute Move
        let captured = null;
        let finished = false;
        let bonusTurn = false;
        let bonusReason = null;

        if (token.position === this.STATE_HOME) {
            token.position = 0;
        } else {
            token.position = this.getNextPosition(token, diceValue, player.hasCaptured);
        }

        if (token.position === 57) {
            token.isFinished = true;
            finished = true;
            bonusTurn = true;
            bonusReason = 'home';
        }

        // Check Capture
        if (!finished && token.position <= 51) {
            if (!wasHome) {
                const globalPos = this.toGlobalPosition(player.color, token.position);
                if (globalPos !== null && !this.SAFE_ZONES.includes(globalPos)) {
                    // Check enemies
                    for (const otherPlayer of match.players) {
                        if (otherPlayer.userId.toString() === userId.toString()) continue;

                        let enemyTokensAtPos = [];
                        for (const ot of otherPlayer.tokens) {
                            if (ot.position !== -1 && !ot.isFinished && ot.position <= 51) {
                                if (this.toGlobalPosition(otherPlayer.color, ot.position) === globalPos) {
                                    enemyTokensAtPos.push(ot);
                                }
                            }
                        }

                        if (enemyTokensAtPos.length > 0) {
                            // Rule 3: Double vs Single.
                            if (enemyTokensAtPos.length >= 2) {
                                // Double -> Safe. No capture.
                            } else {
                                // Capture Single
                                const capturedToken = enemyTokensAtPos[0];
                                capturedToken.position = -1;
                                this.checkAndResetCaptured(otherPlayer);
                                captured = { tokenId: capturedToken.tokenId, color: otherPlayer.color };
                                bonusTurn = true;
                                bonusReason = 'capture';
                                player.hasCaptured = true;
                            }
                        }
                    }
                }
            }
        }

        if (captured || finished) {
            bonusTurn = true;
            match.currentTurn.pendingBonus = true;
        }

        match.currentTurn.usedDiceIndices.push(diceIndex);
        match.markModified('currentTurn');
        match.markModified('players');

        const allDiceUsed = match.currentTurn.diceValues.length === match.currentTurn.usedDiceIndices.length;

        // Check Win Condition
        const winnerId = this.checkWinCondition(match);

        return {
            captured,
            finished,
            bonusTurn,
            bonusReason,
            allDiceUsed,
            match,
            missedTokenId,
            pendingBonus: match.currentTurn.pendingBonus,
            winnerId
        };
    }
    
    async switchTurn(io, match, logger) {
        const { startTimer, clearTimer } = require('../services/timer.service');

        if (match.state !== "RUNNING") {
            logger.warn(`[GameLogic] switchTurn skipped. Match ${match._id} is ${match.state}`);
            return null;
        }

        const nextPlayer = this.getNextTurnColor(match);

        if (!nextPlayer) {
            match.state = 'ABANDONED';
            await match.save();
            clearTimer(match._id, match.currentTurn ? match.currentTurn.turn : 0); // Clear any lingering timer
            logger.info(`[GameLogic] Match ${match._id} abandoned. No active players.`);
            return null;
        }

        const currentTurnNumber = match.currentTurn ? match.currentTurn.turn : 0;
        match.currentTurn = {
            userId: nextPlayer.userId,
            color: nextPlayer.color,
            diceValues: [],
            usedDiceIndices: [],
            rollCount: 0,
            pendingBonus: false,
            rollingPhase: true,
            turn: (currentTurnNumber || 0) + 1,
            turnDeadline: new Date(Date.now() + 15000)
        };
        await match.save();

        const Match = require("../models/Match");
        const populatedMatch = await Match.findById(match._id).populate({
            path: "currentTurn.userId",
            select: "_id fullName playerStats avatar"
        });

        const roomName = `game:${match._id}`;
        io.to(roomName).emit("game:turnChanged", populatedMatch.currentTurn);

        startTimer(io, match._id, populatedMatch.currentTurn.turn);

        return populatedMatch.currentTurn;
    }

    checkWinCondition(match) {
        // 1v1 or 4P
        if (match.gameType === "1V1" || match.gameType === "4P") {
            const finishedPlayer = match.players.find(p => p.tokens.every(t => t.isFinished));
            if (finishedPlayer) return finishedPlayer.userId;
        }
        // 2v2
        if (match.gameType === "2V2") {
            // Check if any team has won
            for (let teamId of [1, 2]) {
                const teamPlayers = match.players.filter(p => p.team === teamId);
                if (teamPlayers.length > 0 && teamPlayers.every(p => p.tokens.every(t => t.isFinished))) {
                    // For 2v2, we need a single winner ID to return? Or handle logically.
                    // The schema has `winner` as ObjectId.
                    // We can set it to the first player of the team, or handle team logic elsewhere.
                    // Returning first player ID for now.
                    return teamPlayers[0].userId;
                }
            }
        }
        return null;
    }

    /**
     * Calculate a score for tie-breaking
     * Sum of all token positions (Home=-1 -> 0, Finished -> 57)
     */
    calculatePlayerScore(player) {
        let score = 0;
        if (!player.tokens) return 0;
        player.tokens.forEach(t => {
            if (t.isFinished) score += 57; // Max path + home run
            else if (t.position === -1) score += 0;
            else score += t.position;
        });
        return score;
    }

    /**
     * Get players ranked by performance
     */
    getRankedPlayers(match, winnerId) {
        const winnerIdStr = winnerId.toString();
        
        // Map to intermediate object
        const playersWithScore = match.players.map(p => {
            // Handle populated or unpopulated userId
            const uId = p.userId._id ? p.userId._id.toString() : p.userId.toString();
            return {
                ...p.toObject ? p.toObject() : p,
                score: this.calculatePlayerScore(p),
                isWinner: uId === winnerIdStr,
                isEligible: p.status !== 'LEFT' && p.status !== 'DISQUALIFIED'
            };
        });

        // Sort
        playersWithScore.sort((a, b) => {
            // 1. Winner always top
            if (a.isWinner) return -1;
            if (b.isWinner) return 1;

            // 2. Eligibility (Leavers go to bottom)
            if (a.isEligible && !b.isEligible) return -1;
            if (!a.isEligible && b.isEligible) return 1;

            // 3. Score (Descending) - Who moved furthest
            if (b.score !== a.score) return b.score - a.score;

            // 4. Captures (Descending) - Tie breaker
            if (a.hasCaptured && !b.hasCaptured) return -1;
            if (!a.hasCaptured && b.hasCaptured) return 1;

            return 0;
        });

        return playersWithScore;
    }

    /**
     * Helper to generate detailed game over payload with Winners/Losers lists
     */
    async getGameOverPayload(matchId, winnerId, reason, totalPrize) {
        const Match = require("../models/Match");
        const match = await Match.findById(matchId).populate({
            path: "players.userId",
            select: "_id fullName avatar userName"
        });

        if (!match) return null;

        // Get Ranked List (Calculates 2nd place etc.)
        const rankedPlayers = this.getRankedPlayers(match, winnerId);

        const winners = [];
        const losers = [];
        const winnerIdStr = winnerId.toString();

        // Determine Winning Team (for 2v2)
        let winningTeam = null;
        if (match.gameType === "2V2") {
            const winnerPlayer = match.players.find(p => p.userId._id.toString() === winnerIdStr);
            if (winnerPlayer) winningTeam = winnerPlayer.team;
        }

        // Map ranked players to response format
        const playersData = rankedPlayers.map((p, index) => {
            const pId = p.userId._id ? p.userId._id.toString() : p.userId.toString();
            const isWinner = p.isWinner || (winningTeam && p.team === winningTeam);
            let winningAmount = 0;

            if (match.gameType === "2V2") {
                if (isWinner) {
                    winningAmount = totalPrize / 2; // Split prize for 2v2
                }
            } else if (match.gameType === "4P" || (match.players.length === 4 && match.gameType !== "2V2")) {
                // 4P Split: 1st (75%), 2nd (25%)
                if (index === 0) { // 1st Place
                    winningAmount = Math.floor(totalPrize * 0.75);
                } else if (index === 1 && p.isEligible) { // 2nd Place
                    winningAmount = totalPrize - Math.floor(totalPrize * 0.75);
                }
            } else {
                // 1v1 (Winner Takes All)
                if (isWinner) {
                    winningAmount = totalPrize;
                }
            }

            return {
                userId: p.userId._id,
                name: p.userId.fullName || p.userId.userName || "Unknown",
                avatar: p.userId.avatar,
                team: p.team,
                // tokensHome, // Removed as requested
                isWinner,
                winningAmount
            };
        });

        // Assign Ranks and populate lists
        playersData.forEach((p, index) => {
            p.rank = p.isWinner ? 1 : (match.gameType === "2V2" ? 2 : index + 1);
            
            // Remove internal flag before pushing
            const { isWinner, ...playerObj } = p;
            
            if (isWinner) winners.push(playerObj);
            else losers.push(playerObj);
        });

        return {
            winners,
            losers,
            reason,
            matchId,
            totalPrize,
            gameType: match.gameType,
            tournamentId: match.tournamentId
        };
    }
}
module.exports = {
    GameLogic: new GameLogic(),
};
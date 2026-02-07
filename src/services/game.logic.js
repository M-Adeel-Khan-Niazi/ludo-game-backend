const Match = require("../models/Match");

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
    }

    /**
     * Roll 2 dice
     */
    rollDice() {
        return [
            Math.floor(Math.random() * 6) + 1,
            Math.floor(Math.random() * 6) + 1
        ];
    }

    /**
     * Get the next turn color
     */
    getNextTurnColor(currentMatch) {
        const colors = ['red', 'green', 'yellow', 'blue'];
        const activePlayers = currentMatch.players
            .filter(p => p.status === 'ACTIVE')
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

        // Rule 1: Must open with 6
        if (token.position === this.STATE_HOME) {
            return diceValue === 6;
        }

        let potentialPos = token.position + diceValue;

        // Rule 5: Cannot go to home unless hit someone
        if (potentialPos > 51) {
            if (!player.hasCaptured) {
                // Wrap around 52 -> 0
                // (51 + 1) % 52 = 0
                potentialPos = potentialPos % 52;
            } else {
                // Enter Home Path
                if (potentialPos > 57) return false; // Exact throw needed
            }
        }

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

        let potentialPos = token.position + diceValue;
        if (!player.hasCaptured && potentialPos > 51) potentialPos %= 52;
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


    async applyMove(match, userId, tokenId, diceIndex) {
        const player = match.players.find(p => p.userId.toString() === userId.toString());
        if (!player) throw new Error("Player not found");
        if (match.currentTurn.userId.toString() !== userId.toString()) throw new Error("Not your turn");

        const token = player.tokens.find(t => t.tokenId === tokenId);
        if (!token) throw new Error("Token not found");
        const wasHome = (token.position === this.STATE_HOME);

        if (match.currentTurn.usedDiceIndices.includes(diceIndex)) throw new Error("Dice already used");

        const diceValue = match.currentTurn.diceValues[diceIndex];

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
            }
        }

        // Execute Move
        let captured = false;
        let finished = false;
        let bonusTurn = false;

        if (token.position === this.STATE_HOME) {
            token.position = 0;
        } else {
            let nextPos = token.position + diceValue;
            if (nextPos > 51) {
                if (!player.hasCaptured) {
                    token.position = nextPos % 52;
                } else {
                    token.position = nextPos;
                }
            } else {
                token.position = nextPos;
            }
        }

        if (token.position === 57) {
            token.isFinished = true;
            finished = true;
            bonusTurn = true;
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
                                enemyTokensAtPos.forEach(ot => ot.position = -1);
                                captured = true;
                                bonusTurn = true;
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
        await match.save();

        const allDiceUsed = match.currentTurn.diceValues.length === match.currentTurn.usedDiceIndices.length;

        // Check Win Condition
        const winnerId = this.checkWinCondition(match);

        return {
            captured,
            finished,
            bonusTurn,
            allDiceUsed,
            match,
            missedTokenId, // Fixed Name
            pendingBonus: match.currentTurn.pendingBonus,
            winnerId
        };
    }

    async switchTurn(match) {
        const nextPlayer = this.getNextTurnColor(match);
        if (nextPlayer) {
            match.currentTurn = {
                userId: nextPlayer.userId,
                color: nextPlayer.color,
                diceValues: [],
                usedDiceIndices: [],
                rollCount: 0,
                pendingBonus: false,
                rollingPhase: true,
                turnDeadline: new Date(Date.now() + 15000) // 15s Timer
            };
            await match.save();
        }
        return match.currentTurn;
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
}

module.exports = new GameLogic();

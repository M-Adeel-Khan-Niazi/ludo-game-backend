const Match = require("../models/Match");

class GameLogic {
    constructor() {
        // Game Constants
        this.PATH_LENGTH = 52; // Main board path steps
        this.HOME_PATH_LENGTH = 6; // Steps to reach home center
        this.TOTAL_STEPS = this.PATH_LENGTH + this.HOME_PATH_LENGTH; // 58 steps total (0 to 57)

        // Token States
        this.STATE_HOME = -1; // In base
        this.STATE_FINISHED = 999; // Reached end

        // Safe Zones (Global Indices on main path)
        this.SAFE_ZONES = [0, 8, 13, 21, 26, 34, 39, 47];
    }

    /**
     * Roll 2 dice
     * @returns {Array<Number>} [d1, d2]
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
     * Validate if a move is possible for a specific dice value
     * @param {Object} token - Token object from Match model
     * @param {Number} diceValue 
     */
    isValidMove(token, diceValue) {
        if (token.isFinished) return false;

        // If at home, need 6 to start
        if (token.position === this.STATE_HOME) {
            return diceValue === 6;
        }

        const potentialPos = token.position + diceValue;
        return potentialPos <= 57;
    }

    /**
     * Calculate global position for collision detection
     */
    toGlobalPosition(color, relativePos) {
        if (relativePos === -1 || relativePos > 50) return null; // Home or Safe Home Path

        let offset = 0;
        if (color === 'green') offset = 13;
        if (color === 'yellow') offset = 26;
        if (color === 'blue') offset = 39;

        return (relativePos + offset) % 52;
    }

    /**
     * Execute a move with a specific dice value (index)
     * @returns {Object} { captured, finished, bonusTurn, match, diceUsedIndex }
     */
    async applyMove(match, userId, tokenId, diceIndex) {
        const player = match.players.find(p => p.userId.toString() === userId.toString());
        if (!player) throw new Error("Player not found in match");

        // Verify Turn
        if (match.currentTurn.userId.toString() !== userId.toString()) {
            throw new Error("Not your turn");
        }

        const token = player.tokens.find(t => t.tokenId === tokenId);
        if (!token) throw new Error("Token not found");

        // Validate Die
        if (match.currentTurn.usedDiceIndices.includes(diceIndex)) {
            throw new Error("Dice already used");
        }
        if (diceIndex < 0 || diceIndex >= match.currentTurn.diceValues.length) {
            throw new Error("Invalid dice index");
        }

        const diceValue = match.currentTurn.diceValues[diceIndex];

        if (!this.isValidMove(token, diceValue)) {
            throw new Error("Invalid move for this dice value");
        }

        let captured = false;
        let finished = false;
        // Bonus only if you finish or capture, OR if you roll double 6? 
        // Standard rules: finish/capture = bonus. 6 = usually bonus if single die or if used? 
        // With 2 dice, getting 6 often gives bonus too. Ludo usually allows another roll on 6.
        // Let's stick to capture/finish = bonus turn.
        // Rolling doubles (e.g. 6,6) might be bonus. 
        // User asked for "2 dice". Let's assume standard behavior:
        // You use both numbers. If you roll 6, you get another turn *after* using dice?
        // Let's implement Capture/Finish bonus for now.
        let bonusTurn = false;

        // Update Position
        if (token.position === this.STATE_HOME) {
            token.position = 0; // Move to start
        } else {
            token.position += diceValue;
        }

        // Check Finish
        if (token.position === 57) {
            token.isFinished = true;
            finished = true;
            bonusTurn = true;
        }

        // Check Captures
        if (!finished && token.position <= 50) {
            const globalPos = this.toGlobalPosition(player.color, token.position);

            if (globalPos !== null && !this.SAFE_ZONES.includes(globalPos)) {
                for (const otherPlayer of match.players) {
                    if (otherPlayer.userId.toString() === userId.toString()) continue;

                    for (const otherToken of otherPlayer.tokens) {
                        if (otherToken.position === -1 || otherToken.isFinished || otherToken.position > 50) continue;

                        const otherGlobal = this.toGlobalPosition(otherPlayer.color, otherToken.position);

                        if (globalPos === otherGlobal) {
                            otherToken.position = -1; // Send home
                            captured = true;
                            bonusTurn = true;
                        }
                    }
                }
            }
        }

        // Mark dice as used
        match.currentTurn.usedDiceIndices.push(diceIndex);

        await match.save();

        // Determine if turn is completely over
        const allDiceUsed = match.currentTurn.diceValues.length === match.currentTurn.usedDiceIndices.length;

        // If bonus turn triggered (by capture/finish), we might want to clear used dice and let them roll again?
        // OR does bonus turn mean "after this full turn"?
        // Usually, if you capture, you get to Roll Again.
        // So if I capture using specific Die 1, do I roll again immediately? Or finish Die 2 then roll again?
        // Standard: Finish using current dice, then roll again.

        return {
            captured,
            finished,
            bonusTurn, // This implies "Rights to roll again after dice are exhausted"
            allDiceUsed,
            match
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
                rollCount: 0
            };
            await match.save();
        }
        return match.currentTurn;
    }
}

module.exports = new GameLogic();

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
     * Helper: Check if a global position has a Double (2+ tokens of same color)
     */
    isDouble(match, globalPos, excludeColor) {
        // Check for any player having >= 2 tokens at this globalPos
        for (const p of match.players) {
            // "excludeColor" usually means we are checking enemies. 
            // If "excludeColor" is passed, we skip that color (e.g. self).
            if (p.color === excludeColor) continue;

            const tokensAtPos = p.tokens.filter(t => {
                if (t.position === -1 || t.isFinished || t.position > 50) return false;
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
        // Entry to home is when position > 50.
        // If !hasCaptured, wrap around instead of entering home.
        if (!player.hasCaptured && potentialPos > 50) {
            // Loop: 50 -> 0 (based on relative path)
            // Example: pos 48, roll 5 -> 53 (home path 2).
            // If !captured, should land on relative 1 (start + 1)?
            // Relative path 0-51 (52 steps).
            // 50 + 1 = 51 (last square). 50 + 2 = 52 (Home 0).
            // Wrap logic: (pos + dice) % 52.
            // But we need to be careful. The "Home Entrance" is at relative 50?
            // Let's assume path is 0..50 (51 squares) + 51 (Home arrow) -> Home Path.
            // "PATH_LENGTH = 52". Indices 0..51.
            // Entrance is at 50? Or 51?
            // Usually step 51 is the one before home.
            // If pos + dice > 50, and !captured, we wrap:
            // potentialPos = (token.position + diceValue) % 52;
            potentialPos = (token.position + diceValue) % 52;
        }

        // Rule 6: Exact number for home
        if (player.hasCaptured && potentialPos > 57) {
            return false; // Loose those numbers
        }

        // If entering Home Path (51-56), check if valid
        // 57 is destination (Center). > 57 invalid.

        // Rule 3: Double Protection (No single coin can hit double coin)
        // Check destination for Double
        if (potentialPos <= 50) { // On main board
            const globalDest = this.toGlobalPosition(player.color, potentialPos);
            // Check if enemies have Double there
            if (this.isDouble(match, globalDest, player.color)) {
                // If I am single? Or always?
                // Rule: "No single Coin can hit double coin".
                // Assuming moving single.
                // If I land on double -> Invalid Move (Safe).
                return false;
            }
        }

        return true;
    }

    /**
     * Helper: Check if a move would result in a capture
     */
    checkCapture(match, player, token, diceValue) {
        if (token.position === this.STATE_HOME && diceValue !== 6) return false;
        if (token.position === this.STATE_HOME && diceValue === 6) {
            // Rule 1 Part 2: Opening with 6 -> Cannot hit (Safe).
            return false;
        }

        let potentialPos = token.position + diceValue;
        if (!player.hasCaptured && potentialPos > 50) potentialPos %= 52;
        if (potentialPos > 50) return false; // In safe zone/home path

        const globalDest = this.toGlobalPosition(player.color, potentialPos);
        if (this.SAFE_ZONES.includes(globalDest)) return false;

        // Check for enemies
        for (const p of match.players) {
            if (p.userId.toString() === player.userId.toString()) continue;
            for (const t of p.tokens) {
                if (t.position === -1 || t.isFinished || t.position > 50) continue;
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
        for (const t of player.tokens) {
            if (t.isFinished) continue;
            // potential capture with SAME dice?
            if (this.isValidMove(t, diceValue, player, match) && this.checkCapture(match, player, t, diceValue)) {
                // 't' could capture.
                if (t.tokenId !== tokenId) {
                    // Start Move didn't capture (or different token used).
                    // Even if the CHOSEN move captures, if another token could ALSO capture, is it a miss?
                    // "If you forget to hit". If I hit with A, I didn't forget.
                    // So if current move IS a capture, then no penalty?
                    // But we don't know if current move is capture yet.
                    // We can check `this.checkCapture` for current `token` too.
                    if (this.checkCapture(match, player, token, diceValue)) {
                        // Chosen move captures. No penalty.
                    } else {
                        // Chosen move does NOT capture. But 't' COULD.
                        missedTokenId = t.tokenId;
                    }
                }
            }
        }

        // Apply Penalty if missed
        if (missedTokenId) {
            const groundedToken = player.tokens.find(t => t.tokenId === missedTokenId);
            if (groundedToken) {
                groundedToken.position = -1; // Grounded
            }
            // Turn continues with the move?
            // "your coin... will be grounded".
            // Usually move happens too.
        }

        // Execute Move
        let captured = false;
        let finished = false;
        let bonusTurn = false;

        if (token.position === this.STATE_HOME) {
            token.position = 0;
        } else {
            let nextPos = token.position + diceValue;
            if (!player.hasCaptured && nextPos > 50) {
                token.position = (token.position + diceValue) % 52;
            } else {
                token.position += diceValue;
            }
        }

        if (token.position === 57) {
            token.isFinished = true;
            finished = true;
            bonusTurn = true;
        }

        // Check Capture
        if (!finished && token.position <= 50) {
            // Rule 1 Exception: If opening move (wasHome), NO capture.
            if (!wasHome) {
                const globalPos = this.toGlobalPosition(player.color, token.position);
                if (!this.SAFE_ZONES.includes(globalPos)) {
                    // Check enemies
                    for (const otherPlayer of match.players) {
                        if (otherPlayer.userId.toString() === userId.toString()) continue;

                        let enemyTokensAtPos = [];
                        for (const ot of otherPlayer.tokens) {
                            if (ot.position !== -1 && !ot.isFinished && ot.position <= 50) {
                                if (this.toGlobalPosition(otherPlayer.color, ot.position) === globalPos) {
                                    enemyTokensAtPos.push(ot);
                                }
                            }
                        }

                        // Rule 3: Double vs Single.
                        // If enemies have >= 2 tokens -> Double. Safe.
                        // My token arrived.
                        if (enemyTokensAtPos.length > 0) {
                            if (enemyTokensAtPos.length >= 2) {
                                // Safe. No capture.
                                // "No single coin can hit double coin".
                                // Effectively, they co-exist? Or was move invalid?
                                // I made move invalid in isValidMove. So this shouldn't happen?
                                // Yes, isDouble check in isValidMove prevents this branch.
                            } else {
                                // Capture Single
                                enemyTokensAtPos.forEach(ot => ot.position = -1);
                                captured = true;
                                bonusTurn = true;
                                player.hasCaptured = true; // Rule 5 satisfied
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

        return { captured, finished, bonusTurn, allDiceUsed, match, groundedTokenId, pendingBonus: match.currentTurn.pendingBonus };
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
                pendingBonus: false
            };
            await match.save();
        }
        return match.currentTurn;
    }
}



module.exports = new GameLogic();

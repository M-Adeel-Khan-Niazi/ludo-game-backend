class GameLogic {
    constructor() {
        // Game Constants
        this.PATH_LENGTH = 52; // Main board path steps (0-51)
        this.HOME_PATH_LENGTH = 6; // Steps to reach home center (52-57)
        this.TOTAL_STEPS = this.PATH_LENGTH + this.HOME_PATH_LENGTH; // 58 steps total

        // Token States
        this.STATE_HOME = -1; // In base
        this.STATE_FINISHED = 999; // Reached end

        /** Use with moveToken when spending both unused dice as one combined move */
        this.COMBINED_DICE_INDEX = -1;

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
            if (this.countTokensAtGlobal(match, globalPos, p.color) >= 2) return true;
        }
        return false;
    }

    /**
     * Group main-path tokens at a global cell by player color.
     */
    getTokensByColorAtGlobal(match, globalPos) {
        const byColor = {};
        for (const p of match.players) {
            for (const t of p.tokens) {
                if (t.position === -1 || t.isFinished || t.position > 51) continue;
                if (this.toGlobalPosition(p.color, t.position) !== globalPos) continue;
                if (!byColor[p.color]) byColor[p.color] = { player: p, tokens: [] };
                byColor[p.color].tokens.push(t);
            }
        }
        return byColor;
    }

    countTokensAtGlobal(match, globalPos, color) {
        const entry = this.getTokensByColorAtGlobal(match, globalPos)[color];
        return entry ? entry.tokens.length : 0;
    }

    /**
     * Capture matrix: double beats single/double; single only beats single.
     */
    canCaptureAtCell(moverCount, enemyCount) {
        if (enemyCount === 0) return false;
        if (moverCount >= 2) return true;
        if (moverCount === 1 && enemyCount === 1) return true;
        return false;
    }

    _resetPlayerHasCapturedIfAllHome(player) {
        if (!player.tokens.some(t => t.isFinished) && player.tokens.every(t => t.position === -1)) {
            player.hasCaptured = false;
        }
    }

    _applyTokenCaptures(tokens, victimPlayer, captures) {
        for (const t of tokens) {
            t.position = -1;
            captures.push({
                tokenId: t.tokenId,
                color: victimPlayer.color,
            });
        }
        this._resetPlayerHasCapturedIfAllHome(victimPlayer);
    }

    /**
     * When both players have a double (2+ tokens) on the same cell, the active player
     * captures all opponent tokens on that cell (before moving or on landing).
     */
    resolveDoubleVsDoubleBattle(match, globalPos, attackerColor, { grantBonus = false } = {}) {
        if (globalPos === null || this.SAFE_ZONES.includes(globalPos)) {
            return { captures: [], grantBonus: false };
        }

        const byColor = this.getTokensByColorAtGlobal(match, globalPos);
        const moverCount = byColor[attackerColor]?.tokens.length || 0;
        if (moverCount < 2) {
            return { captures: [], grantBonus: false };
        }

        const captures = [];
        let bonusEligible = false;
        const attackerPlayer = match.players.find((p) => p.color === attackerColor);
        if (!attackerPlayer) {
            return { captures, grantBonus: false };
        }

        for (const p of match.players) {
            if (p.color === attackerColor) continue;
            const enemyTokens = byColor[p.color]?.tokens || [];
            if (enemyTokens.length < 2) continue;
            if (!this.canCaptureAtCell(moverCount, enemyTokens.length)) continue;

            this._applyTokenCaptures(enemyTokens, p, captures);
            attackerPlayer.hasCaptured = true;
            bonusEligible = grantBonus;
        }

        return { captures, grantBonus: bonusEligible };
    }

    /**
     * Resolve captures when a mover lands on a cell (or preview via hypothetical counts).
     */
    resolveLandingCaptures(match, globalPos, attackerColor, { grantBonus = true } = {}) {
        if (globalPos === null || this.SAFE_ZONES.includes(globalPos)) {
            return { captures: [], grantBonus: false };
        }

        const byColor = this.getTokensByColorAtGlobal(match, globalPos);
        const moverCount = byColor[attackerColor]?.tokens.length || 0;
        const captures = [];
        let bonusEligible = false;

        const attackerPlayer = match.players.find(p => p.color === attackerColor);
        if (!attackerPlayer || moverCount === 0) {
            return { captures, grantBonus: false };
        }

        for (const p of match.players) {
            if (p.color === attackerColor) continue;
            const enemyTokens = byColor[p.color]?.tokens || [];
            if (!this.canCaptureAtCell(moverCount, enemyTokens.length)) continue;

            this._applyTokenCaptures(enemyTokens, p, captures);
            attackerPlayer.hasCaptured = true;
            bonusEligible = grantBonus;
        }

        return { captures, grantBonus: bonusEligible };
    }

    /**
     * When a double splits by moving one token away, resolve co-occupancy on the source cell.
     */
    resolveDepartureCaptures(match, globalPos, departingColor, beforeCounts) {
        if (globalPos === null || this.SAFE_ZONES.includes(globalPos)) {
            return { captures: [], grantBonus: false };
        }

        const beforeDeparting = beforeCounts[departingColor] || 0;
        if (beforeDeparting < 2) {
            return { captures: [], grantBonus: false };
        }

        const byColor = this.getTokensByColorAtGlobal(match, globalPos);
        const afterDeparting = byColor[departingColor]?.tokens.length || 0;
        if (afterDeparting === 0 || afterDeparting >= beforeDeparting) {
            return { captures: [], grantBonus: false };
        }

        const departingEntry = byColor[departingColor];
        const departingTokens = departingEntry?.tokens || [];
        const captures = [];

        for (const p of match.players) {
            if (p.color === departingColor) continue;
            const otherTokens = byColor[p.color]?.tokens || [];
            if (otherTokens.length === 0) continue;

            if (afterDeparting === 1 && otherTokens.length === 1) {
                this._applyTokenCaptures(departingTokens, departingEntry.player, captures);
                p.hasCaptured = true;
                break;
            }
        }

        return { captures, grantBonus: false };
    }

    /**
     * Hypothetical mover count at globalDest after moving token there.
     */
    getHypotheticalMoverCountAtGlobal(match, player, token, globalDest) {
        const tokenGlobal = this.toGlobalPosition(player.color, token.position);
        let count = this.countTokensAtGlobal(match, globalDest, player.color);
        if (tokenGlobal === globalDest) {
            return count;
        }
        return count + 1;
    }

    isValidMove(token, diceValue, player, match, isCombinedDice = false) {
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

        // Rule 1: Must open with 6 (combined dice cannot unlock tokens from HOME)
        if (token.position === this.STATE_HOME) {
            return !isCombinedDice && diceValue === 6;
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

        const potentialPos = this.getNextPosition(token, diceValue, player.hasCaptured);
        if (potentialPos > 51) return false; // In safe zone/home path

        const globalDest = this.toGlobalPosition(player.color, potentialPos);
        if (globalDest === null || this.SAFE_ZONES.includes(globalDest)) return false;

        const moverCount = this.getHypotheticalMoverCountAtGlobal(match, player, token, globalDest);

        for (const p of match.players) {
            if (p.userId.toString() === player.userId.toString()) continue;
            const enemyCount = this.countTokensAtGlobal(match, globalDest, p.color);
            if (this.canCaptureAtCell(moverCount, enemyCount)) return true;
        }

        // Double vs double already on destination before this token arrives
        const existingAtDest = this.countTokensAtGlobal(match, globalDest, player.color);
        if (existingAtDest >= 2) {
            for (const p of match.players) {
                if (p.userId.toString() === player.userId.toString()) continue;
                const enemyCount = this.countTokensAtGlobal(match, globalDest, p.color);
                if (enemyCount >= 2 && this.canCaptureAtCell(existingAtDest, enemyCount)) {
                    return true;
                }
            }
        }

        return false;
    }

    getUnusedDiceIndices(match) {
        if (!match?.currentTurn?.diceValues) return [];
        return match.currentTurn.diceValues
            .map((_, i) => i)
            .filter((i) => !match.currentTurn.usedDiceIndices.includes(i));
    }

    getCombinedDiceValue(match, unusedIndices) {
        if (!unusedIndices || unusedIndices.length < 2) return null;
        return unusedIndices.reduce(
            (sum, idx) => sum + match.currentTurn.diceValues[idx],
            0
        );
    }

    canCaptureWithDiceValue(match, player, diceValue) {
        if (!match || !player || diceValue == null) return false;
        for (const token of player.tokens) {
            if (token.isFinished) continue;
            if (this.isValidMove(token, diceValue, player, match)) {
                if (this.checkCapture(match, player, token, diceValue)) return true;
            }
        }
        return false;
    }

    /**
     * Capture warning across: first die, second die, and combined sum (when 2+ dice unused).
     */
    getCaptureWarning(match, player) {
        const capturePossible = {
            firstDie: false,
            secondDie: false,
            combined: false,
            doubleStack: false,
        };
        const unusedIndices = this.getUnusedDiceIndices(match);

        if (!match || !player || !unusedIndices.length) {
            return { captureWarning: null, capturePossible };
        }

        for (const idx of unusedIndices) {
            const diceValue = match.currentTurn.diceValues[idx];
            if (!this.canCaptureWithDiceValue(match, player, diceValue)) continue;
            if (idx === 0) capturePossible.firstDie = true;
            if (idx === 1) capturePossible.secondDie = true;
            else capturePossible[`die${idx}`] = true;
        }

        // Existing double vs enemy double on a cell the player occupies
        for (const t of player.tokens) {
            if (t.isFinished || t.position > 51 || t.position === this.STATE_HOME) continue;
            const g = this.toGlobalPosition(player.color, t.position);
            if (g === null || this.SAFE_ZONES.includes(g)) continue;
            const ownCount = this.countTokensAtGlobal(match, g, player.color);
            if (ownCount < 2) continue;
            for (const p of match.players) {
                if (p.color === player.color) continue;
                const enemyCount = this.countTokensAtGlobal(match, g, p.color);
                if (enemyCount >= 2 && this.canCaptureAtCell(ownCount, enemyCount)) {
                    capturePossible.doubleStack = true;
                    break;
                }
            }
        }

        const combinedValue = this.getCombinedDiceValue(match, unusedIndices);
        if (combinedValue !== null) {
            capturePossible.combined = this.canCaptureWithDiceValue(match, player, combinedValue);
        }

        const anyPossible =
            capturePossible.firstDie ||
            capturePossible.secondDie ||
            capturePossible.combined ||
            capturePossible.doubleStack;

        return {
            captureWarning: anyPossible
                ? "A capture is possible. Move with caution!"
                : null,
            capturePossible,
        };
    }

    /**
     * Check if the current player can capture any opponent token with the available unused dice.
     */
    isCapturePossible(match, player, unusedIndices) {
        if (!match || !player || !match.currentTurn?.diceValues) return false;
        const indices = unusedIndices ?? this.getUnusedDiceIndices(match);
        return this.getCaptureWarning(match, player).captureWarning !== null;
    }

    hasAnyValidMove(match, player) {
        const unusedIndices = this.getUnusedDiceIndices(match);
        if (!unusedIndices.length) return false;

        for (const idx of unusedIndices) {
            const val = match.currentTurn.diceValues[idx];
            if (player.tokens.some((t) => this.isValidMove(t, val, player, match))) return true;
        }

        const combinedValue = this.getCombinedDiceValue(match, unusedIndices);
        if (combinedValue !== null) {
            if (player.tokens.some((t) => this.isValidMove(t, combinedValue, player, match, true))) {
                return true;
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

        const unusedIndices = this.getUnusedDiceIndices(match);
        let diceValue;
        let indicesToConsume = [diceIndex];

        if (diceIndex === this.COMBINED_DICE_INDEX) {
            if (unusedIndices.length < 2) {
                throw new Error("Combined move requires at least two unused dice");
            }
            diceValue = this.getCombinedDiceValue(match, unusedIndices);
            indicesToConsume = [...unusedIndices];
        } else {
            if (match.currentTurn.usedDiceIndices.includes(diceIndex)) {
                throw new Error("Dice already used");
            }
            diceValue = match.currentTurn.diceValues[diceIndex];
        }

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
                if (!player.tokens.some(t => t.isFinished) && player.tokens.every(t => t.position === -1)) {
                    player.hasCaptured = false;
                }
            }
        }

        // Source cell before move (for split-double resolution)
        let fromGlobalPos = null;
        let beforeCounts = null;
        if (!wasHome && token.position <= 51) {
            fromGlobalPos = this.toGlobalPosition(player.color, token.position);
            if (fromGlobalPos !== null && !this.SAFE_ZONES.includes(fromGlobalPos)) {
                beforeCounts = {};
                for (const p of match.players) {
                    beforeCounts[p.color] = this.countTokensAtGlobal(match, fromGlobalPos, p.color);
                }
            }
        }

        let captures = [];
        let captured = null;
        let finished = false;
        let bonusTurn = false;
        let bonusReason = null;

        // Double vs double on the token's current cell — resolve before the move
        if (fromGlobalPos !== null) {
            const battleResult = this.resolveDoubleVsDoubleBattle(
                match,
                fromGlobalPos,
                player.color,
                { grantBonus: true }
            );
            if (battleResult.captures.length > 0) {
                captures = captures.concat(battleResult.captures);
                captured = battleResult.captures[0];
                if (battleResult.grantBonus) {
                    bonusTurn = true;
                    bonusReason = 'capture';
                    match.currentTurn.pendingBonus = (match.currentTurn.pendingBonus || 0) + 1;
                }
            }
        }

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

        // Landing capture (includes forming a double on an enemy stack)
        if (!finished && token.position <= 51) {
            const globalPos = this.toGlobalPosition(player.color, token.position);
            if (globalPos !== null && !this.SAFE_ZONES.includes(globalPos)) {
                const landingResult = this.resolveLandingCaptures(match, globalPos, player.color, {
                    grantBonus: true,
                });
                if (landingResult.captures.length > 0) {
                    captures = captures.concat(landingResult.captures);
                    captured = captured || landingResult.captures[0];
                    if (landingResult.grantBonus) {
                        bonusTurn = true;
                        bonusReason = 'capture';
                        match.currentTurn.pendingBonus = (match.currentTurn.pendingBonus || 0) + 1;
                    }
                }
            }
        }

        // Source-cell capture when a double splits (no bonus turn)
        if (fromGlobalPos !== null && beforeCounts) {
            const departureResult = this.resolveDepartureCaptures(match, fromGlobalPos, player.color, beforeCounts);
            if (departureResult.captures.length > 0) {
                captures = captures.concat(departureResult.captures);
                captured = captured || departureResult.captures[0];
            }
        }

        if (captures.length > 0) {
            match.markModified('players');
        }

        if (finished) {
            bonusTurn = true;
            bonusReason = 'home';
            match.currentTurn.pendingBonus = (match.currentTurn.pendingBonus || 0) + 1;
        }

        for (const idx of indicesToConsume) {
            if (!match.currentTurn.usedDiceIndices.includes(idx)) {
                match.currentTurn.usedDiceIndices.push(idx);
            }
        }
        match.markModified('currentTurn');
        match.markModified('players');

        const allDiceUsed =
            this.getUnusedDiceIndices(match).length === 0;

        // Check Win Condition
        const winnerId = this.checkWinCondition(match);

        return {
            captured,
            captures,
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
        const { startTimer, clearTimer, emitTurnTimerSync } = require('../services/timer.service');

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
            pendingBonus: 0,
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

        startTimer(io, populatedMatch, populatedMatch.currentTurn.turn);
        emitTurnTimerSync(io, roomName, populatedMatch);

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
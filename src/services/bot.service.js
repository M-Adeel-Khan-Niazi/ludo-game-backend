const Match = require("../models/Match");
const User = require("../models/User");
const { GameLogic } = require("./game.logic");
const GameActionService = require("./gameAction.service");
const { BOT_ENABLED, BOT_FILL_DELAY_MS, BOT_TURN_START_DELAY_MS, BOT_POST_ROLL_DELAY_MS, BOT_BONUS_TURN_DELAY_MS, BOT_CONTINUE_MOVE_DELAY_MS } = require("../config/env");
const { getMatchLock } = require("../utils/lock");
const logger = require("../config/logger");

const BOT_NAMES = require("../data/botNames.json");

const BOT_PROFILES = [
    { color: "yellow" },
    { color: "green" },
    { color: "blue" },
];

const DIFFICULTY_NOISE = {
    BRONZE: 80,
    SILVER: 40,
    GOLD: 10,
    PLATINUM: 0,
};

const pendingFillTimers = new Map();
const pendingBotTurnTimers = new Map();

function _generateFakeStats() {
    return {
        gamesPlayed: Math.floor(Math.random() * 200) + 50,
        games4PWon: Math.floor(Math.random() * 40) + 10,
        games2PWon: Math.floor(Math.random() * 30) + 5,
        tournamentWon: Math.floor(Math.random() * 5),
        totalCoinsEarned: Math.floor(Math.random() * 5000) + 500,
        totalCoinsSpent: Math.floor(Math.random() * 3000) + 200,
    };
}

function _pickUniqueName(usedNames) {
    const available = BOT_NAMES.filter(n => !usedNames.has(n));
    if (available.length === 0) {
        return "Player" + Math.floor(Math.random() * 9999 + 1000);
    }
    return available[Math.floor(Math.random() * available.length)];
}

class BotService {
    isEnabled() {
        return BOT_ENABLED;
    }

    cancelScheduledFill(matchId) {
        const key = matchId.toString();
        if (pendingFillTimers.has(key)) {
            clearTimeout(pendingFillTimers.get(key));
            pendingFillTimers.delete(key);
        }
    }

    cancelPendingBotTurn(matchId) {
        const key = matchId.toString();
        if (pendingBotTurnTimers.has(key)) {
            clearTimeout(pendingBotTurnTimers.get(key));
            pendingBotTurnTimers.delete(key);
        }
    }

    /**
     * Fill a practice match with bots immediately.
     * Bypasses BOT_ENABLED and BOT_FILL_DELAY — practice mode always works.
     */
    async fillPracticeBots(matchId) {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match || match.state !== "WAITING" || !match.isVsBot) {
                return null;
            }

            const humanPlayers = match.players.filter((p) => !p.isBot);
            if (humanPlayers.length === 0) return null;

            const slotsNeeded = match.maxPlayers - match.players.length;
            if (slotsNeeded <= 0) return null;

            await this.ensureBotUsers(match, slotsNeeded);

            const usedColors = match.players.map((p) => p.color);
            const allColors = ["red", "yellow", "green", "blue"];
            const difficultyTier = match.difficultyTier || "BRONZE";

            for (const color of allColors) {
                if (match.players.length >= match.maxPlayers) break;
                if (usedColors.includes(color)) continue;

                const botUserId = await this.getBotUserIdForColor(color, difficultyTier);
                if (!botUserId) continue;
                if (match.players.some((p) => p.userId.toString() === botUserId.toString())) continue;

                match.players.push(this._buildBotPlayer(color, botUserId, match));
                usedColors.push(color);
            }

            this._startMatch(match);
            await match.save();

            const populatedMatch = await Match.findById(matchId)
                .populate({ path: "players.userId", select: "_id fullName playerStats avatar isBot" })
                .populate({ path: "currentTurn.userId", select: "_id fullName playerStats avatar isBot" });

            if (global.io) {
                const roomName = `game:${matchId}`;
                const botsPayload = {
                    matchId: matchId.toString(),
                    message: "Practice match ready — playing against bots",
                    botsAdded: match.players.filter((p) => p.isBot).length,
                    state: match.state,
                };
                global.io.to(roomName).emit("game:botsJoined", botsPayload);
                for (const p of match.players) {
                    if (!p.isBot) {
                        global.io.to(`user:${p.userId}`).emit("game:botsJoined", botsPayload);
                    }
                }
                global.io.to(roomName).emit("game:state", populatedMatch);

                if (match.state === "RUNNING") {
                    const { startTimer } = require("./timer.service");
                    startTimer(global.io, populatedMatch, populatedMatch.currentTurn.turn);
                    this.onTurnChanged(global.io, matchId);
                }
            }

            logger.info(`[Bot] Practice match ${matchId} started — ${match.players.length}/${match.maxPlayers} players (tier: ${difficultyTier})`);
            return populatedMatch;
        } finally {
            release();
        }
    }

    scheduleFill(matchId) {
        if (!this.isEnabled()) return;

        this.cancelScheduledFill(matchId);
        const timer = setTimeout(() => {
            pendingFillTimers.delete(matchId.toString());
            this.fillMatchWithBots(matchId).catch((err) => {
                logger.error(`[Bot] fillMatchWithBots failed for ${matchId}:`, err);
            });
        }, BOT_FILL_DELAY_MS);

        pendingFillTimers.set(matchId.toString(), timer);
    }

    async ensureBotUsers(match, slotsNeeded) {
        const playerIds = match.players.map(p => p.userId);
        const existingUsers = await User.find({ _id: { $in: playerIds } }).select("fullName isBot");
        const usedNames = new Set(existingUsers.map(u => u.fullName).filter(Boolean));

        const needed = Math.min(slotsNeeded || BOT_PROFILES.length, BOT_PROFILES.length);
        const profilesToEnsure = BOT_PROFILES.slice(0, needed);

        for (const profile of profilesToEnsure) {
            const chosenName = _pickUniqueName(usedNames);
            usedNames.add(chosenName);

            const userName = `ludo_bot_${profile.color}_${match.difficultyTier || "BRONZE"}`;
            const fakeStats = _generateFakeStats();

            let user;
            try {
                user = await User.findOneAndUpdate(
                    { userName },
                    {
                        $setOnInsert: {
                            userName,
                            isVerified: true,
                            isProfileCompleted: true,
                            email: `${userName}@bots.local`,
                        },
                        $set: {
                            isBot: true,
                            fullName: chosenName,
                            avatar: String(Math.floor(Math.random() * 20) + 1),
                            playerStats: fakeStats,
                        },
                    },
                    { new: true, upsert: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                if (err?.code !== 11000) throw err;
                user = await User.findOne({ userName });
            }

            if (!user) throw new Error(`Unable to create or load bot user ${userName}`);
        }
    }

    async getBotUserIdForColor(color, difficultyTier) {
        const userName = `ludo_bot_${color}_${difficultyTier || "BRONZE"}`;
        const user = await User.findOne({ userName });
        return user ? user._id : null;
    }

    _buildBotPlayer(color, botUserId, match) {
        const prefix = color[0].toUpperCase();

        return {
            userId: botUserId,
            color,
            isBot: true,
            status: "ACTIVE",
            team: this._getBotTeam(match),
            isHost: false,
            hasCaptured: false,
            tokens: [
                { tokenId: `${prefix}1`, position: -1, isFinished: false },
                { tokenId: `${prefix}2`, position: -1, isFinished: false },
                { tokenId: `${prefix}3`, position: -1, isFinished: false },
                { tokenId: `${prefix}4`, position: -1, isFinished: false },
            ],
        };
    }

    _getBotTeam(match) {
        if (match.gameType !== "2V2") return null;

        const teamCounts = { 1: 0, 2: 0 };
        for (const player of match.players) {
            if (player.team === 1 || player.team === 2) {
                teamCounts[player.team]++;
            }
        }

        if (teamCounts[1] < 2 && teamCounts[1] <= teamCounts[2]) return 1;
        if (teamCounts[2] < 2) return 2;
        if (teamCounts[1] < 2) return 1;
        return 2;
    }

    _canStartMatch(match) {
        if (match.players.length < 2) return false;
        if (match.isPrivate) return false;
        const gt = (match.gameType || "").toUpperCase();
        if (gt === "1V1") return match.players.length >= 2;
        return match.players.length >= match.maxPlayers;
    }

    _startMatch(match) {
        match.state = "RUNNING";
        const firstPlayer = match.players.find((p) => p.color === "red") || match.players[0];
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
    }

    async fillMatchWithBots(matchId) {
        if (!this.isEnabled()) return null;

        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
            const match = await Match.findById(matchId);
            if (!match || match.state !== "WAITING" || match.isPrivate || match.tournamentId || match.isVsBot) {
                return null;
            }

            const humanPlayers = match.players.filter((p) => !p.isBot);
            if (humanPlayers.length === 0) return null;

            const slotsNeeded = match.maxPlayers - match.players.length;
            if (slotsNeeded <= 0) return null;

            await this.ensureBotUsers(match, slotsNeeded);

            const usedColors = match.players.map((p) => p.color);
            const allColors = ["red", "yellow", "green", "blue"];
            const difficultyTier = match.difficultyTier || "BRONZE";

            for (const color of allColors) {
                if (match.players.length >= match.maxPlayers) break;
                if (usedColors.includes(color)) continue;

                const botUserId = await this.getBotUserIdForColor(color, difficultyTier);
                if (!botUserId) continue;
                if (match.players.some((p) => p.userId.toString() === botUserId.toString())) continue;

                match.players.push(this._buildBotPlayer(color, botUserId, match));
                usedColors.push(color);
            }

            match.isVsBot = true;

            if (this._canStartMatch(match)) {
                this._startMatch(match);
            }

            await match.save();

            const populatedMatch = await Match.findById(matchId)
                .populate({ path: "players.userId", select: "_id fullName playerStats avatar isBot" })
                .populate({ path: "currentTurn.userId", select: "_id fullName playerStats avatar isBot" });

            if (global.io) {
                const roomName = `game:${matchId}`;
                const botsPayload = {
                    matchId: matchId.toString(),
                    message: "Opponent bots joined the match",
                    botsAdded: match.players.filter((p) => p.isBot).length,
                    state: match.state,
                };
                global.io.to(roomName).emit("game:botsJoined", botsPayload);
                for (const p of match.players) {
                    if (!p.isBot) {
                        global.io.to(`user:${p.userId}`).emit("game:botsJoined", botsPayload);
                    }
                }
                global.io.to(roomName).emit("game:state", populatedMatch);

                if (match.state === "RUNNING") {
                    const { startTimer } = require("./timer.service");
                    startTimer(global.io, populatedMatch, populatedMatch.currentTurn.turn);
                    this.onTurnChanged(global.io, matchId);
                }
            }

            logger.info(`[Bot] Filled match ${matchId} - ${match.players.length}/${match.maxPlayers} players (tier: ${difficultyTier})`);
            return populatedMatch;
        } finally {
            release();
        }
    }

    isBotUserId(match, userId) {
        const id = userId.toString();
        const player = match.players.find((p) => p.userId.toString() === id);
        return player?.isBot === true;
    }

    isCurrentTurnBot(match) {
        if (!match?.currentTurn?.userId) return false;
        return this.isBotUserId(match, match.currentTurn.userId);
    }

    onTurnChanged(io, matchId) {
        if (!io || !this.isEnabled()) return;

        this.cancelPendingBotTurn(matchId);

        const timer = setTimeout(async () => {
            pendingBotTurnTimers.delete(matchId.toString());
            try {
                await this._executeBotTurn(io, matchId);
            } catch (err) {
                logger.error(`[Bot] _executeBotTurn error for ${matchId}:`, err);
            }
        }, BOT_TURN_START_DELAY_MS);

        pendingBotTurnTimers.set(matchId.toString(), timer);
    }

    _scheduleBotAction(io, matchId, delay, phase) {
        this.cancelPendingBotTurn(matchId);

        const timer = setTimeout(async () => {
            pendingBotTurnTimers.delete(matchId.toString());
            try {
                await this._playBotTurnPhase(io, matchId, phase);
            } catch (err) {
                logger.error(`[Bot] scheduled ${phase} action error for ${matchId}:`, err);
            }
        }, delay);

        pendingBotTurnTimers.set(matchId.toString(), timer);
    }

    async _executeBotTurn(io, matchId) {
        const match = await Match.findById(matchId);
        if (!match || match.state !== "RUNNING") return;
        if (!this.isCurrentTurnBot(match)) return;

        const phase = match.currentTurn.rollingPhase ? "roll" : "move";
        await this._playBotTurnPhase(io, matchId, phase);
    }

    async _playBotTurnPhase(io, matchId, phase) {
        if (phase === "roll") {
            const match = await Match.findById(matchId);
            if (!match || match.state !== "RUNNING") return;
            if (!this.isCurrentTurnBot(match)) return;

            let rollResult;
            try {
                rollResult = await GameActionService.rollDice(io, matchId, match.currentTurn.userId);
            } catch (err) {
                if (err.message === "Not your turn" || err.message === "Game not running") return;
                logger.error(`[Bot] rollDice error for ${matchId}:`, err.message);
                return;
            }

            if (rollResult.canRollAgain) {
                this._scheduleBotAction(io, matchId, BOT_BONUS_TURN_DELAY_MS, "roll");
                return;
            }

            if (!rollResult.hasValidMoves) {
                return;
            }

            if (rollResult.switchedTurn) {
                return;
            }

            this._scheduleBotAction(io, matchId, BOT_POST_ROLL_DELAY_MS, "move");
            return;
        }

        if (phase === "move") {
            const match = await Match.findById(matchId);
            if (!match || match.state !== "RUNNING") return;
            if (!this.isCurrentTurnBot(match)) return;
            if (match.currentTurn.rollingPhase) {
                this._scheduleBotAction(io, matchId, BOT_TURN_START_DELAY_MS, "roll");
                return;
            }

            const player = match.players.find(
                (p) => p.userId.toString() === match.currentTurn.userId.toString()
            );
            if (!player) return;

            const move = this._pickBestMove(match, player);

            if (!move) {
                logger.warn(`[Bot] No valid moves for bot in match ${matchId}`);
                return;
            }

            let moveResult;
            try {
                moveResult = await GameActionService.moveToken(
                    io, matchId, match.currentTurn.userId, move.tokenId, move.diceIndex
                );
            } catch (err) {
                if (err.message === "Not your turn" || err.message === "Game not running") return;
                logger.error(`[Bot] moveToken error for ${matchId}:`, err.message);
                return;
            }

            if (moveResult.gameOver) return;

            if (moveResult.bonusTurn) {
                this._scheduleBotAction(io, matchId, BOT_BONUS_TURN_DELAY_MS, "roll");
                return;
            }

            if (moveResult.continueMove) {
                this._scheduleBotAction(io, matchId, BOT_CONTINUE_MOVE_DELAY_MS, "move");
                return;
            }

            if (moveResult.switchedTurn) {
                const afterMove = await Match.findById(matchId);
                if (afterMove && afterMove.state === "RUNNING" && this.isCurrentTurnBot(afterMove)) {
                    this.onTurnChanged(io, matchId);
                }
                return;
            }

            const afterMove = await Match.findById(matchId);
            if (afterMove && afterMove.state === "RUNNING" && this.isCurrentTurnBot(afterMove)) {
                this.onTurnChanged(io, matchId);
            }
        }
    }

    _scoreMove(match, player, token, diceIndex) {
        const difficultyTier = (match.difficultyTier || "BRONZE").toUpperCase();
        const isCombinedDice = diceIndex === GameLogic.COMBINED_DICE_INDEX;
        const diceValue = isCombinedDice
            ? GameLogic.getCombinedDiceValue(match, GameLogic.getUnusedDiceIndices(match))
            : match.currentTurn.diceValues[diceIndex];

        if (!GameLogic.isValidMove(token, diceValue, player, match, isCombinedDice)) return -1;

        let score = 10;
        if (GameLogic.checkCapture(match, player, token, diceValue)) score += 100;

        const potentialPos = GameLogic.getNextPosition(token, diceValue, player.hasCaptured);
        if (potentialPos === 57) score += 80;
        if (token.position === GameLogic.STATE_HOME && diceValue === 6) score += 50;
        if (potentialPos > token.position && token.position >= 0) score += potentialPos;

        const noise = DIFFICULTY_NOISE[difficultyTier] || DIFFICULTY_NOISE.BRONZE;
        score += Math.random() * noise;

        return score;
    }

    _pickBestMove(match, player) {
        const unusedIndices = match.currentTurn.diceValues
            .map((_, i) => i)
            .filter((i) => !match.currentTurn.usedDiceIndices.includes(i));
        const moveDiceIndices = [...unusedIndices];

        if (GameLogic.getCombinedDiceValue(match, unusedIndices) !== null) {
            moveDiceIndices.push(GameLogic.COMBINED_DICE_INDEX);
        }

        let best = null;
        let bestScore = -1;

        for (const diceIndex of moveDiceIndices) {
            for (const token of player.tokens) {
                if (token.isFinished) continue;
                const score = this._scoreMove(match, player, token, diceIndex);
                if (score > bestScore) {
                    bestScore = score;
                    best = { tokenId: token.tokenId, diceIndex };
                }
            }
        }

        return best;
    }

    async cleanupBotUsers(matchId, preloadedBotIds) {
        try {
            let botPlayerIds = preloadedBotIds;

            if (!botPlayerIds) {
                const match = await Match.findById(matchId);
                if (!match) return;

                botPlayerIds = match.players
                    .filter(p => p.isBot)
                    .map(p => p.userId.toString());
            }

            if (!botPlayerIds || botPlayerIds.length === 0) return;

            const activeMatches = await Match.find({
                _id: { $ne: matchId },
                state: { $in: ["RUNNING", "WAITING"] },
                "players.userId": { $in: botPlayerIds }
            });

            const activeBotIds = new Set();
            for (const activeMatch of activeMatches) {
                for (const p of activeMatch.players) {
                    if (p.isBot) {
                        activeBotIds.add(p.userId.toString());
                    }
                }
            }

            const botsToDelete = botPlayerIds.filter(id => !activeBotIds.has(id));

            if (botsToDelete.length > 0) {
                const User = require("../models/User");
                await User.deleteMany({
                    _id: { $in: botsToDelete },
                    isBot: true
                });
                logger.info(`[Bot] Cleaned up ${botsToDelete.length} bot user(s) from completed match ${matchId}`);
            }
        } catch (err) {
            logger.error(`[Bot] cleanupBotUsers error for match ${matchId}:`, err.message);
        }
    }
}

module.exports = new BotService();
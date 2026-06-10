const Match = require("../models/Match");
const User = require("../models/User");
const { GameLogic } = require("./game.logic");
const GameActionService = require("./gameAction.service");
const { BOT_ENABLED, BOT_FILL_DELAY_MS, BOT_TURN_DELAY_MS } = require("../config/env");
const { getMatchLock } = require("../utils/lock");
const logger = require("../config/logger");

const BOT_PROFILES = [
    { userName: "ludo_bot_yellow", fullName: "Yellow Bot", color: "yellow" },
    { userName: "ludo_bot_green", fullName: "Green Bot", color: "green" },
    { userName: "ludo_bot_blue", fullName: "Blue Bot", color: "blue" },
];

const pendingFillTimers = new Map();
const botUserCache = new Map();

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

    async ensureBotUsers() {
        if (botUserCache.size >= BOT_PROFILES.length) return;

        for (const profile of BOT_PROFILES) {
            if (botUserCache.has(profile.color)) continue;

            let user;
            try {
                user = await User.findOneAndUpdate(
                    { userName: profile.userName },
                    {
                        $setOnInsert: {
                            userName: profile.userName,
                            fullName: profile.fullName,
                            isBot: true,
                            isVerified: true,
                            isProfileCompleted: true,
                            email: `${profile.userName}@bots.local`,
                            avatar: null,
                        },
                        $set: { isBot: true },
                    },
                    { new: true, upsert: true, setDefaultsOnInsert: true }
                );
            } catch (err) {
                if (err?.code !== 11000) throw err;
                user = await User.findOne({ userName: profile.userName });
            }

            if (!user) throw new Error(`Unable to create or load bot user ${profile.userName}`);
            botUserCache.set(profile.color, user._id);
        }
    }

    async getBotUserIdForColor(color) {
        await this.ensureBotUsers();
        const id = botUserCache.get(color);
        if (!id) throw new Error(`No bot configured for color ${color}`);
        return id;
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
            pendingBonus: false,
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

        await this.ensureBotUsers();

        const usedColors = match.players.map((p) => p.color);
        const allColors = ["red", "yellow", "green", "blue"];

        for (const color of allColors) {
            if (match.players.length >= match.maxPlayers) break;
            if (usedColors.includes(color)) continue;

            const botUserId = await this.getBotUserIdForColor(color);
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

        logger.info(`[Bot] Filled match ${matchId} - ${match.players.length}/${match.maxPlayers} players`);
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

        setTimeout(async () => {
            try {
                const match = await Match.findById(matchId);
                if (!match || match.state !== "RUNNING") return;
                if (!this.isCurrentTurnBot(match)) return;
                await this.playBotTurn(io, matchId);
            } catch (err) {
                logger.error(`[Bot] playBotTurn error match ${matchId}:`, err);
            }
        }, BOT_TURN_DELAY_MS);
    }

    _scoreMove(match, player, token, diceIndex) {
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

    async playBotTurn(io, matchId) {
        const match = await Match.findById(matchId);
        if (!match || match.state !== "RUNNING") return;
        if (!this.isCurrentTurnBot(match)) return;

        const botUserId = match.currentTurn.userId;

        if (match.currentTurn.rollingPhase) {
            const rollResult = await GameActionService.rollDice(io, matchId, botUserId);

            if (rollResult.canRollAgain) {
                return this.playBotTurn(io, matchId);
            }
            if (rollResult.switchedTurn || rollResult.gameOver) return;

            const freshMatch = await Match.findById(matchId);
            if (!freshMatch || !this.isCurrentTurnBot(freshMatch)) return;
            if (freshMatch.currentTurn.rollingPhase) return;

            return this.playBotTurn(io, matchId);
        }

        const freshMatch = await Match.findById(matchId);
        if (!freshMatch || !this.isCurrentTurnBot(freshMatch)) return;

        const player = freshMatch.players.find(
            (p) => p.userId.toString() === botUserId.toString()
        );
        const move = this._pickBestMove(freshMatch, player);
        if (!move) {
            await GameLogic.switchTurn(io, freshMatch, logger);
            return;
        }

        const moveResult = await GameActionService.moveToken(
            io,
            matchId,
            botUserId,
            move.tokenId,
            move.diceIndex
        );

        if (moveResult.gameOver) return;

        const afterMove = await Match.findById(matchId);
        if (!afterMove || afterMove.state !== "RUNNING") return;

        if (this.isCurrentTurnBot(afterMove)) {
            if (afterMove.currentTurn.rollingPhase || moveResult.continueMove || moveResult.bonusTurn) {
                return this.playBotTurn(io, matchId);
            }
        }
    }
}

module.exports = new BotService();

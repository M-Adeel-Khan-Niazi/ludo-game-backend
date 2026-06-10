const mongoose = require("mongoose");
const Match = require("../models/Match");
const User = require("../models/User");
const WalletService = require("./wallet.service"); // Using the file provided by user mapping
const { getMatchLock } = require("../utils/lock");

// Helper to generate 6-digit room code
const generateRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

class MatchService {

    _playerId(userId) {
        return userId?._id ? userId._id.toString() : userId.toString();
    }

    /**
     * Resolve which win counter to increment for a completed match.
     */
    _getWinStatField(match) {
        const gameType = (match.gameType || "").toUpperCase();
        if (gameType === "1V1") return "playerStats.games2PWon";
        if (gameType === "2V2" || gameType === "4P") return "playerStats.games4PWon";
        const playerCount = match.maxPlayers || match.players.length;
        return playerCount > 2 ? "playerStats.games4PWon" : "playerStats.games2PWon";
    }

    /**
     * Increment gamesPlayed / win counters after a match completes.
     */
    async _updatePlayerStatsOnGameEnd(match, winnerId, paidUserIds = new Set()) {
        const winField = this._getWinStatField(match);
        const gameType = (match.gameType || "").toUpperCase();
        const paid = paidUserIds instanceof Set ? paidUserIds : new Set(paidUserIds);

        for (const p of match.players) {
            if (p.isBot) continue;
            await User.findByIdAndUpdate(this._playerId(p.userId), {
                $inc: { "playerStats.gamesPlayed": 1 },
            });
        }

        if (gameType === "2V2") {
            for (const userId of paid) {
                const player = match.players.find((p) => this._playerId(p.userId) === userId);
                if (player?.isBot) continue;
                await User.findByIdAndUpdate(userId, { $inc: { [winField]: 1 } });
            }
            return;
        }

        const winnerPlayer = match.players.find(
            (p) => this._playerId(p.userId) === this._playerId(winnerId)
        );
        if (winnerPlayer?.isBot) return;

        await User.findByIdAndUpdate(this._playerId(winnerId), { $inc: { [winField]: 1 } });
    }

    /**
     * Create a new match (Private or Public)
     */


    // Real Implementation that handles the transaction issue by doing it properly:
    // We will assume WalletService.joinGame is atomic.
    // 1. Create Match document.
    // 2. Call WalletService.joinGame(userId, fee, match._id).
    // 3. Update Match with player.
    // If 2 fails, we delete Match.

    async createMatchAndJoin(userId, color = 'red', gameType, joiningFee, isPrivate, playersCount) {
        const match = new Match({
            gameType,
            joiningFee,
            isPrivate,
            roomCode: generateRoomCode(),
            maxPlayers: (gameType === '4P' || gameType === '2V2' || isPrivate) ? 4 : 2,
            players: [], // We add creator after locking
            winningMultiplier: isPrivate ? 0.9 : 0.85, // Example config
            state: "WAITING",
            adminProfit: 0 // calculated later
        });

        await match.save();

        try {
            // Attempt to lock coins
            await WalletService.joinGame(userId, joiningFee, match._id);

            // If successful, add player to match
            match.players.push({
                userId,
                color,
                status: "ACTIVE",
                team: gameType === '2V2' ? 1 : null,
                isHost: true, // Rule-14: Metadata
                tokens: [
                    { tokenId: `${color[0].toUpperCase()}1`, position: -1, isFinished: false },
                    { tokenId: `${color[0].toUpperCase()}2`, position: -1, isFinished: false },
                    { tokenId: `${color[0].toUpperCase()}3`, position: -1, isFinished: false },
                    { tokenId: `${color[0].toUpperCase()}4`, position: -1, isFinished: false }
                ]
            });
            await match.save();

            const populatedMatch = await Match.findById(match._id)
                .populate({
                    path: "players.userId",
                    select: "_id fullName playerStats avatar isBot"
                });

            if (!isPrivate) {
                const BotService = require("./bot.service");
                BotService.scheduleFill(match._id);
            }

            return populatedMatch;
        } catch (error) {
            // Rollback: Delete match
            await Match.deleteOne({ _id: match._id });
            throw error; // Propagate "Insufficient balance" etc.
        }
    }

    async findPublicMatch(userId, gameType, joiningFee) {
        // Find a match that is WAITING, matching criteria, and has space
        // And user is not already in it
        const match = await Match.findOne({
            gameType,
            joiningFee,
            isPrivate: false,
            isVsBot: { $ne: true },
            state: "WAITING",
            $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] },
            "players.userId": { $ne: userId }
        });

        return match;
    }

    async joinMatch(userId, matchId) {
        const lock = getMatchLock(matchId);
        const release = await lock.acquire();

        try {
        const match = await Match.findById(matchId);
        if (!match) throw new Error("Match not found");
        if (match.state !== "WAITING") throw new Error("Match is not available to join");
        if (match.players.length >= match.maxPlayers) throw new Error("Match is full");
        if (match.players.some(p => p.userId.toString() === userId.toString())) throw new Error("Already joined");

        const BotService = require("./bot.service");
        BotService.cancelScheduledFill(match._id);

        // Lock coins
        await WalletService.joinGame(userId, match.joiningFee, match._id);

        // Determine color/position
        const usedColors = match.players.map(p => p.color);
        // Custom Color Order: Red -> Yellow -> Green -> Blue
        const allColors = ["red", "yellow", "green", "blue"];
        const nextColor = allColors.find(c => !usedColors.includes(c));

        match.players.push({
            userId,
            color: nextColor, 
            status: "ACTIVE",
            team: match.gameType === "2V2" ? (match.players.length < 2 ? 1 : 2) : null,
            isHost: false,
            tokens: [
                { tokenId: `${nextColor[0].toUpperCase()}1`, position: -1, isFinished: false },
                { tokenId: `${nextColor[0].toUpperCase()}2`, position: -1, isFinished: false },
                { tokenId: `${nextColor[0].toUpperCase()}3`, position: -1, isFinished: false },
                { tokenId: `${nextColor[0].toUpperCase()}4`, position: -1, isFinished: false }
            ]
        });

        // Check if full (Private matches must be manually started)
        if (match.players.length === match.maxPlayers && !match.isPrivate) {
            match.state = "RUNNING"; // Ready to start

            // Initialize Turn (Red goes first usually)
            const firstPlayer = match.players.find(p => p.color === "red") || match.players[0];
            match.currentTurn = {
                userId: firstPlayer.userId,
                color: firstPlayer.color,
                diceValues: [],
                usedDiceIndices: [],
                rollCount: 0,
                turn: 1, // Initialize turn number
                turnDeadline: new Date(Date.now() + 15000)
            };
        }

        await match.save();
        if (match.state === "RUNNING" && global.io) {
            const BotService = require("./bot.service");
            BotService.onTurnChanged(global.io, match._id);
        }
        const populatedMatch = await Match.findById(match._id)
            .populate({
                path: "players.userId",
                select: "_id fullName playerStats avatar"
            })
            .populate({
                path: "currentTurn.userId",
                select: "_id fullName playerStats avatar"
            });

        return populatedMatch;
        } finally {
            release();
        }
    }

    // Use this if auto-matching
    async findAndJoin(userId, gameType, joiningFee) {
        const existing = await this.findPublicMatch(userId, gameType, joiningFee);
        if (existing) {
            return await this.joinMatch(userId, existing._id);
        }
        // Create new
        return await this.createMatchAndJoin(userId, 'red', gameType, joiningFee, false);
    }
    /**
     * Handle player leaving a match
     */
    async leaveMatch(matchId, userId) {
        const match = await Match.findById(matchId);
        if (!match) return { action: "ALREADY_DELETED" };

        const playerIndex = match.players.findIndex(p => p.userId.toString() === userId.toString());
        if (playerIndex === -1) return { action: "ALREADY_DELETED" };
        const player = match.players[playerIndex];

        // 1. WAITING State
        if (match.state === "WAITING") {
            // Fallback check to ensure the creator is always treated as host
            const isActualHost = player.isHost || (match.players[0] && match.players[0].userId.toString() === userId.toString());

            // If the host leaves, or it's the last player leaving
            if (isActualHost || match.players.length === 1) {
                // Refund everyone currently in the match
                for (const p of match.players) {
                    try {
                        await WalletService.cancelGame(p.userId, match.joiningFee, match._id);
                    } catch (err) {
                        console.error(`Error refunding player ${p.userId} on match cancel:`, err.message);
                    }
                }
                match.state = "CANCELLED"; // Update state in memory for the final socket broadcast
                await Match.findByIdAndDelete(match._id); // Hard delete from database
                return { action: "MATCH_CANCELLED_BY_HOST", match };
            } else {
                // Non-host leaving a lobby with others present
                try {
                    await WalletService.cancelGame(userId, match.joiningFee, match._id);
                } catch (err) {
                    console.error(`Error refunding player ${userId} on match leave:`, err.message);
                }
                match.players.splice(playerIndex, 1);
                await match.save();
                return { action: "PLAYER_LEFT_LOBBY", match };
            }
        }

        // 2 & 3. RUNNING
        if (match.state === "RUNNING") {
            // Rule 2: 1v1 -> Opponent Wins
            if (match.gameType && match.gameType.toUpperCase() === "1V1") {
                const opponent = match.players.find(p => p.userId.toString() !== userId.toString());
                if (opponent) {
                    // Settle Wallet Logic

                    // Leaver: Loss (Lose joining fee)
                    await WalletService.settleLoss(userId, match.joiningFee, match._id);

                    // Winner: Win
                    // Prize = Pool * Multiplier
                    const pool = match.joiningFee * 2;
                    const prize = Math.floor(pool * match.winningMultiplier);
                    const adminDiff = pool - prize;

                    await WalletService.settleWin(opponent.userId, match.joiningFee, prize, match._id);

                    match.winner = opponent.userId;
                    match.winningAmount = prize;
                    match.adminProfit = (match.adminProfit || 0) + adminDiff;
                    match.state = "COMPLETED";

                    player.status = "LEFT";

                    await match.save();
                    await this._updatePlayerStatsOnGameEnd(
                        match,
                        opponent.userId,
                        new Set([this._playerId(opponent.userId)])
                    );
                    return { action: "GAME_ENDED", winnerId: opponent.userId, winnerAmount: prize, match };
                }
            }

            // Rule 3: Other matches → Mark as LEFT
            player.status = "LEFT";
            await WalletService.settleLoss(userId, match.joiningFee, match._id);

            player.tokens.forEach(t => t.position = -1);
            await match.save();

            // --- 2v2: Check if an entire team is eliminated ---
            if (match.gameType && match.gameType.toUpperCase() === "2V2") {
                const leaverTeam = player.team;
                const teamPlayers = match.players.filter(p => p.team === leaverTeam);
                const teamEliminated = teamPlayers.every(p => ["LEFT", "DISQUALIFIED"].includes(p.status));

                if (teamEliminated) {
                    // The entire team is gone — opposing team wins
                    const opposingTeam = match.players.filter(p => p.team !== leaverTeam && !["LEFT", "DISQUALIFIED"].includes(p.status));
                    if (opposingTeam.length > 0) {
                        const winnerId = opposingTeam[0].userId;
                        const { prize } = await this.settleGame(match, winnerId);
                        return { action: "GAME_ENDED", winnerId, winnerAmount: prize, reason: "Opponent Team Left", match };
                    }
                }
            }

            // Check if only 1 player remaining (Last Man Standing)
            const remaining = match.players.filter(p => !["LEFT", "DISQUALIFIED"].includes(p.status));

            if (remaining.length === 1) {
                const winnerId = remaining[0].userId;
                // Settle
                const { prize } = await this.settleGame(match, winnerId);
                return { action: "GAME_ENDED", winnerId, winnerAmount: prize, reason: "Last Man Standing", match };
            }

            return { action: "PLAYER_LEFT_GAME", match };
        }

        return { action: "NO_ACTION" };
    }

    /**
     * Settle game for a natural win
     */
    async settleGame(match, winnerId) {
        if (match.state === "COMPLETED") return { prize: match.winningAmount || 0 };

        const { GameLogic } = require("./game.logic");

        // Prize Calculation (bot matches use virtual 2-player pool for 1v1-style payout)
        const humanCount = match.players.filter((p) => !p.isBot).length;
        const poolPlayerCount = match.isVsBot
            ? Math.max(humanCount * 2, 2)
            : match.players.length;
        const pool = match.joiningFee * poolPlayerCount;
        const netPrize = Math.floor(pool * match.winningMultiplier);
        const prize = netPrize;
        const adminDiff = pool - netPrize;

        const paidUserIds = new Set();
        paidUserIds.add(winnerId.toString());

        // Distribute Winnings
        if (match.gameType === "4P" || (match.players.length === 4 && match.gameType !== "2V2")) {
            const rankedPlayers = GameLogic.getRankedPlayers(match, winnerId);
            const winner = rankedPlayers[0];
            const runnerUp = rankedPlayers[1];

            // Split: 75% to 1st, 25% to 2nd
            const firstPrize = Math.floor(netPrize * 0.75);
            const secondPrize = netPrize - firstPrize;

            // Credit Winner
            if (!winner.isBot) {
                await WalletService.settleWin(winner.userId, match.joiningFee, firstPrize, match._id);
            }

            // Credit Runner Up (if eligible)
            if (runnerUp && runnerUp.isEligible && !runnerUp.isBot) {
                await WalletService.settleWin(runnerUp.userId, match.joiningFee, secondPrize, match._id);
                paidUserIds.add(runnerUp.userId.toString());
            }
            // If runnerUp is not eligible (e.g. Left), the secondPrize is burned (not distributed)

        } else if (match.gameType === "2V2") {
            // Find winning team
            const winnerPlayer = match.players.find(p => p.userId.toString() === winnerId.toString());
            if (winnerPlayer) {
                const teamId = winnerPlayer.team;
                const teamMembers = match.players.filter(p => p.team === teamId);
                const splitPrize = Math.floor(netPrize / teamMembers.length);

                for (const member of teamMembers) {
                    if (!member.isBot) {
                        await WalletService.settleWin(member.userId, match.joiningFee, splitPrize, match._id);
                    }
                    paidUserIds.add(member.userId.toString());
                }
            }
        } else {
            // 1v1 or others - Winner Takes All
            const winnerPlayer = match.players.find(
                (p) => p.userId.toString() === winnerId.toString()
            );
            if (!winnerPlayer?.isBot) {
                await WalletService.settleWin(winnerId, match.joiningFee, netPrize, match._id);
            }
        }

        // Handle Losers (Unlock/Burn their locked coins via settleLoss)
        for (const p of match.players) {
            if (p.isBot) continue;
            if (!paidUserIds.has(p.userId.toString())) {
                await WalletService.settleLoss(p.userId, match.joiningFee, match._id);
            } else {
                p.status = "WON";
            }
        }

        match.winner = winnerId;
        match.winningAmount = netPrize;
        match.adminProfit = (match.adminProfit || 0) + adminDiff;
        match.state = "COMPLETED";

        await match.save();

        await this._updatePlayerStatsOnGameEnd(match, winnerId, paidUserIds);

        // If this is a tournament match, notify tournament service
        if (match.tournamentId) {
            try {
                const TournamentService = require("./tournament.service");
                const tournamentResult = await TournamentService.onMatchComplete(match._id, winnerId);

                if (tournamentResult && global.io) {
                    const Tournament = require("../models/Tournament");
                    const tournament = await Tournament.findById(match.tournamentId);
                    if (!tournament) return { prize, adminDiff };

                    const tournamentRoom = `tournament:${tournament._id}`;

                    if (tournamentResult.finalStarted) {
                        // Notify semi-final winners about the final
                        const semiFinalRound = tournament.rounds.find(r => r.roundNumber === 1);
                        const finalRound = tournament.rounds.find(r => r.roundNumber === 2);
                        if (semiFinalRound && finalRound) {
                            const finalists = semiFinalRound.matches.map(m => m.winner);
                            finalists.forEach(userId => {
                                global.io.to(`user:${userId}`).emit("tournament:finalStarting", {
                                    tournamentId: tournament._id,
                                    matchId: finalRound.matches[0].matchId,
                                    message: "You qualified for the final!"
                                });
                            });
                        }
                    }

                    if (tournamentResult.tournamentComplete) {
                        // Notify all tournament players
                        tournament.players.forEach(p => {
                            global.io.to(`user:${p.userId}`).emit("tournament:completed", {
                                tournamentId: tournament._id,
                                winnerId,
                                prize: tournament.prizePool,
                                name: tournament.name
                            });
                        });
                    }
                }
            } catch (err) {
                const logger = require("../config/logger");
                logger.error("Tournament hook error in settleGame:", err);
            }
        }


        return { prize, netPrize, adminDiff };
    }

    /**
     * Get active match for a user
     */
    async getUserGameStatus(userId) {
        // 1. Check for Active Match (Running or Waiting) - Highest Priority
        const match = await Match.findOne({
            state: { $in: ["WAITING", "RUNNING"] },
            "players.userId": userId
        })
        .populate({
            path: "players.userId",
            select: "_id fullName playerStats avatar"
        })
        .populate({
            path: "currentTurn.userId",
            select: "_id fullName playerStats avatar"
        });

        if (match) {
            return {
                userStatus: "IN_GAME",
                data: match
            };
        }

        // 2. Check for Tournament Status
        const Tournament = require("../models/Tournament");
        // Find the latest tournament the user is involved in
        const tournament = await Tournament.findOne({
            "players.userId": userId
        }).sort({ createdAt: -1 })
        .populate("players.userId", "_id fullName avatar");

        if (tournament) {
            // Case: Registered but not started
            if (tournament.status === "REGISTRATION") {
                return { userStatus: "REGISTERED", data: tournament };
            }

            // Case: Tournament Active (Semi/Final) but NOT in a match (Waiting/Eliminated)
            if (tournament.status === "SEMI_FINAL" || tournament.status === "FINAL") {
                return { userStatus: "IN_TOURNAMENT", data: tournament };
            }

            // Case: Completed or Cancelled (Return only if recent, e.g., last 24h, to avoid stuck state)
            if (["COMPLETED", "CANCELLED"].includes(tournament.status)) {
                // Optional: You can add a time check here if needed
                return { userStatus: tournament.status, data: tournament };
            }
        }

        // 3. User is Idle
        return { userStatus: "IDLE", data: null };
    }
}

module.exports = new MatchService();

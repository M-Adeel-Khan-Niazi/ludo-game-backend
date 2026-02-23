const mongoose = require("mongoose");
const Match = require("../models/Match");
const WalletService = require("./wallet.service"); // Using the file provided by user mapping

// Helper to generate 6-digit room code
const generateRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

class MatchService {

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
            maxPlayers: (gameType === '4P' || gameType === '2V2') ? 4 : 2,
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
                    select: "_id fullName playerStats avatar"
                });

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
            state: "WAITING",
            $expr: { $lt: [{ $size: "$players" }, "$maxPlayers"] },
            "players.userId": { $ne: userId }
        });

        return match;
    }

    async joinMatch(userId, matchId) {
        const match = await Match.findById(matchId);
        if (!match) throw new Error("Match not found");
        if (match.state !== "WAITING") throw new Error("Match is not available to join");
        if (match.players.length >= match.maxPlayers) throw new Error("Match is full");
        if (match.players.some(p => p.userId.toString() === userId.toString())) throw new Error("Already joined");

        // Lock coins
        await WalletService.joinGame(userId, match.joiningFee, match._id);

        // Determine color/position
        const usedColors = match.players.map(p => p.color);
        const allColors = ["red", "green", "yellow", "blue"];
        const nextColor = allColors.find(c => !usedColors.includes(c));

        match.players.push({
            userId,
            color: match.gameType === "1V1" ? 'yellow' : nextColor, // 1v1 usually Red vs Yellow
            status: "ACTIVE",
            team: match.gameType === "2V2" ? (match.players.length % 2) + 1 : null,
            isHost: false,
            tokens: [
                { tokenId: `${(match.gameType === "1V1" ? 'yellow' : nextColor)[0].toUpperCase()}1`, position: -1, isFinished: false },
                { tokenId: `${(match.gameType === "1V1" ? 'yellow' : nextColor)[0].toUpperCase()}2`, position: -1, isFinished: false },
                { tokenId: `${(match.gameType === "1V1" ? 'yellow' : nextColor)[0].toUpperCase()}3`, position: -1, isFinished: false },
                { tokenId: `${(match.gameType === "1V1" ? 'yellow' : nextColor)[0].toUpperCase()}4`, position: -1, isFinished: false }
            ]
        });

        // Check if full
        if (match.players.length === match.maxPlayers) {
            match.state = "RUNNING"; // Ready to start

            // Initialize Turn (Red goes first usually)
            const firstPlayer = match.players.find(p => p.color === "red") || match.players[0];
            match.currentTurn = {
                userId: firstPlayer.userId,
                color: firstPlayer.color,
                diceValues: [],
                usedDiceIndices: [],
                rollCount: 0,
                turn: 1 // Initialize turn number
            };
        }

        await match.save();
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
        if (!match) throw new Error("Match not found");

        const playerIndex = match.players.findIndex(p => p.userId.toString() === userId.toString());
        if (playerIndex === -1) throw new Error("Player not in match");
        const player = match.players[playerIndex];

        // 1. Creator leaves, no players joined (WAITING)
        if (match.state === "WAITING") {
            // Rule 1: Created match & no player joined (players.length === 1)
            // Or general leaving lobby logic
            if (match.players.length === 1) {
                await WalletService.cancelGame(userId, match.joiningFee, match._id);
                await Match.deleteOne({ _id: match._id });
                return { action: "MATCH_DELETED" };
            } else {
                // Leaving a lobby with others present
                await WalletService.cancelGame(userId, match.joiningFee, match._id);
                match.players.splice(playerIndex, 1);
                await match.save();
                return { action: "PLAYER_LEFT_LOBBY", match };
            }
        }

        // 2 & 3. RUNNING
        if (match.state === "RUNNING") {
            // Rule 2: 1v1 -> Opponent Wins
            if (match.gameType === "1V1") {
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
                    // Also update opponent status?
                    // opponent.status = "WON"; // No WON status in enum, keep ACTIVE or update schema

                    await match.save();
                    return { action: "GAME_ENDED", winnerId: opponent.userId, winnerAmount: prize, match };
                }
            }

            // Rule 3: Other matches -> Mark as LEFT
            player.status = "LEFT";
            await WalletService.settleLoss(userId, match.joiningFee, match._id);

            player.tokens.forEach(t => t.position = -1);
            await match.save();

            // Check if only 1 player remaining (Last Man Standing)
            const activePlayers = match.players.filter(p => p.status === "ACTIVE" || p.status === "DISCONNECTED");
            // Wait, DISCONNECTED might rejoin. But if ACTIVE == 1 and all others LEFT?
            // "If 3 out of 4 players leave/disconnect".
            // If disconnected, they have timeouts running. 
            // If LEFT, they are gone.
            // If only 1 ACTIVE + DISCONNECTED? 
            // We should only settle if *everyone else* has LEFT or DISQUALIFIED.

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
        if (match.state === "COMPLETED") return;

        const { GameLogic } = require("./game.logic");

        // Prize Calculation
        const pool = match.joiningFee * match.players.length;
        const netPrize = Math.floor(pool * match.winningMultiplier);
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
            await WalletService.settleWin(winner.userId, match.joiningFee, firstPrize, match._id);

            // Credit Runner Up (if eligible)
            if (runnerUp && runnerUp.isEligible) {
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
                    await WalletService.settleWin(member.userId, match.joiningFee, splitPrize, match._id);
                    paidUserIds.add(member.userId.toString());
                }
            }
        } else {
            // 1v1 or others - Winner Takes All
            await WalletService.settleWin(winnerId, match.joiningFee, netPrize, match._id);
        }

        // Handle Losers (Unlock/Burn their locked coins via settleLoss)
        for (const p of match.players) {
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
    async getActiveMatch(userId) {
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

        return match;
    }
}

module.exports = new MatchService();

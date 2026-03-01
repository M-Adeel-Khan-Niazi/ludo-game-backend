const Tournament = require("../models/Tournament");
const Match = require("../models/Match");
const WalletService = require("./wallet.service");
const logger = require("../config/logger");

const COLORS = ["red", "green", "yellow", "blue"];

// Default tournament config — change these values as needed
const DEFAULT_TOURNAMENT = {
    name: "Ludo Championship",
    entryFee: 100,
    winningMultiplier: 0.85
};

class TournamentService {

    /**
     * Ensure there is always an active tournament in REGISTRATION state.
     * Called on server boot and after each tournament completes.
     */
    async ensureActiveTournament() {
        const existing = await Tournament.findOne({ status: "REGISTRATION" });
        if (existing) {
            logger.info("Active tournament already exists: " + existing._id);
            return existing;
        }

        const tournament = await Tournament.create({
            name: DEFAULT_TOURNAMENT.name,
            entryFee: DEFAULT_TOURNAMENT.entryFee,
            winningMultiplier: DEFAULT_TOURNAMENT.winningMultiplier,
            maxPlayers: 16,
            status: "REGISTRATION",
            createdBy: null
        });

        logger.info("Auto-created new tournament: " + tournament._id + " (entry fee: " + tournament.entryFee + ")");
        return tournament;
    }

    /**
     * Get all active tournaments (REGISTRATION state)
     */
    async getActiveTournaments() {
        let tournaments = await Tournament.find({ status: "REGISTRATION" })
            .populate("players.userId", "_id fullName avatar playerStats")
            .sort({ entryFee: 1 });

        if (tournaments.length === 0) {
            await this.ensureActiveTournament();
            return this.getActiveTournaments(); // Recursively call to get the newly created one
        }

        return tournaments;
    }

    /**
     * Create a new tournament
     */
    async createTournament(adminId, { name, entryFee, winningMultiplier = 0.85 }) {
        const tournament = await Tournament.create({
            name,
            entryFee,
            winningMultiplier,
            maxPlayers: 16,
            status: "REGISTRATION",
            createdBy: adminId || null
        });

        return tournament;
    }

    /**
     * Register a player for a tournament
     */
    async registerPlayer(userId, tournamentId) {
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error("Tournament not found");
        if (tournament.status !== "REGISTRATION") throw new Error("Registration is closed");
        if (tournament.players.length >= tournament.maxPlayers) throw new Error("Tournament is full");

        const alreadyRegistered = tournament.players.some(
            p => p.userId.toString() === userId.toString()
        );
        if (alreadyRegistered) throw new Error("Already registered");

        // Lock entry fee
        await WalletService.joinGame(userId, tournament.entryFee, tournamentId);

        tournament.players.push({ userId, registeredAt: new Date() });
        await tournament.save();

        // Auto-start when full
        if (tournament.players.length === tournament.maxPlayers) {
            return { tournament, shouldStart: true };
        }

        return { tournament, shouldStart: false };
    }

    /**
     * Start tournament - create 4 semi-final matches
     */
    async startTournament(tournamentId) {
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error("Tournament not found");
        if (tournament.status !== "REGISTRATION") throw new Error("Tournament already started");
        if (tournament.players.length !== tournament.maxPlayers) throw new Error("Not enough players");

        // Shuffle players randomly
        const shuffled = [...tournament.players].sort(() => Math.random() - 0.5);

        // Create 4 tables of 4 players each
        const semiFinalRound = { roundNumber: 1, matches: [] };

        for (let table = 0; table < 4; table++) {
            const tablePlayers = shuffled.slice(table * 4, (table + 1) * 4);

            const match = new Match({
                gameType: "TOURNAMENT",
                joiningFee: 0,
                isPrivate: false,
                roomCode: Math.floor(100000 + Math.random() * 900000).toString(),
                maxPlayers: 4,
                winningMultiplier: 1,
                state: "RUNNING",
                tournamentId: tournament._id,
                players: tablePlayers.map((p, idx) => ({
                    userId: p.userId,
                    color: COLORS[idx],
                    status: "ACTIVE",
                    team: null,
                    isHost: idx === 0,
                    hasCaptured: false,
                    tokens: [
                        { tokenId: COLORS[idx][0].toUpperCase() + "1", position: -1, isFinished: false },
                        { tokenId: COLORS[idx][0].toUpperCase() + "2", position: -1, isFinished: false },
                        { tokenId: COLORS[idx][0].toUpperCase() + "3", position: -1, isFinished: false },
                        { tokenId: COLORS[idx][0].toUpperCase() + "4", position: -1, isFinished: false }
                    ]
                }))
            });

            const firstPlayer = match.players[0];
            match.currentTurn = {
                userId: firstPlayer.userId,
                color: firstPlayer.color,
                diceValues: [],
                usedDiceIndices: [],
                rollCount: 0,
                pendingBonus: false,
                rollingPhase: true,
                turn: 1,
                turnDeadline: new Date(Date.now() + 15000)
            };

            await match.save();

            semiFinalRound.matches.push({
                matchId: match._id,
                tableNumber: table + 1,
                winner: null
            });
        }

        tournament.rounds.push(semiFinalRound);
        tournament.prizePool = Math.floor(tournament.entryFee * tournament.maxPlayers * tournament.winningMultiplier);
        tournament.status = "SEMI_FINAL";
        await tournament.save();

        logger.info("Tournament " + tournamentId + " started with 4 semi-final matches");

        return tournament;
    }

    /**
     * Called when a tournament match completes - advance the winner
     */
    async onMatchComplete(matchId, winnerId) {
        const tournament = await Tournament.findOne({
            "rounds.matches.matchId": matchId
        });

        if (!tournament) return null;

        // Find and update the match entry in rounds
        let currentRound = null;
        for (const round of tournament.rounds) {
            const matchEntry = round.matches.find(
                m => m.matchId.toString() === matchId.toString()
            );
            if (matchEntry) {
                matchEntry.winner = winnerId;
                currentRound = round;
                break;
            }
        }

        if (!currentRound) return null;

        await tournament.save();

        // Check if all matches in this round are complete
        const allComplete = currentRound.matches.every(m => m.winner != null);

        if (!allComplete) {
            logger.info("Tournament " + tournament._id + ": match " + matchId + " complete, waiting for other tables");
            return { tournament, roundComplete: false };
        }

        // All matches in this round are complete
        if (currentRound.roundNumber === 1) {
            logger.info("Tournament " + tournament._id + ": all semi-finals complete, starting final");
            await this.startFinalRound(tournament._id);
            const updated = await Tournament.findById(tournament._id);
            return { tournament: updated, roundComplete: true, finalStarted: true };
        }

        if (currentRound.roundNumber === 2) {
            logger.info("Tournament " + tournament._id + ": final complete, winner: " + winnerId);
            await this.completeTournament(tournament._id, winnerId);
            const updated = await Tournament.findById(tournament._id);
            return { tournament: updated, roundComplete: true, tournamentComplete: true };
        }

        return { tournament, roundComplete: true };
    }

    /**
     * Start the final round with 4 semi-final winners
     */
    async startFinalRound(tournamentId) {
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error("Tournament not found");

        const semiFinalRound = tournament.rounds.find(r => r.roundNumber === 1);
        if (!semiFinalRound) throw new Error("Semi-final round not found");

        const winners = semiFinalRound.matches.map(m => m.winner);
        if (winners.some(w => w == null)) throw new Error("Not all semi-final winners determined");

        const match = new Match({
            gameType: "TOURNAMENT",
            joiningFee: 0,
            isPrivate: false,
            roomCode: Math.floor(100000 + Math.random() * 900000).toString(),
            maxPlayers: 4,
            winningMultiplier: 1,
            state: "RUNNING",
            tournamentId: tournament._id,
            players: winners.map((userId, idx) => ({
                userId,
                color: COLORS[idx],
                status: "ACTIVE",
                team: null,
                isHost: idx === 0,
                hasCaptured: false,
                tokens: [
                    { tokenId: COLORS[idx][0].toUpperCase() + "1", position: -1, isFinished: false },
                    { tokenId: COLORS[idx][0].toUpperCase() + "2", position: -1, isFinished: false },
                    { tokenId: COLORS[idx][0].toUpperCase() + "3", position: -1, isFinished: false },
                    { tokenId: COLORS[idx][0].toUpperCase() + "4", position: -1, isFinished: false }
                ]
            }))
        });

        const firstPlayer = match.players[0];
        match.currentTurn = {
            userId: firstPlayer.userId,
            color: firstPlayer.color,
            diceValues: [],
            usedDiceIndices: [],
            rollCount: 0,
            pendingBonus: false,
            rollingPhase: true,
            turn: 1,
            turnDeadline: new Date(Date.now() + 15000)
        };

        await match.save();

        tournament.rounds.push({
            roundNumber: 2,
            matches: [{
                matchId: match._id,
                tableNumber: 1,
                winner: null
            }]
        });

        tournament.status = "FINAL";
        await tournament.save();

        logger.info("Tournament " + tournamentId + ": final round created, match " + match._id);

        return { tournament, finalMatch: match };
    }

    /**
     * Complete the tournament - distribute prizes
     */
    async completeTournament(tournamentId, winnerId) {
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error("Tournament not found");

        await WalletService.settleWin(winnerId, tournament.entryFee, tournament.prizePool, tournamentId);

        for (const player of tournament.players) {
            if (player.userId.toString() !== winnerId.toString()) {
                await WalletService.settleLoss(player.userId, tournament.entryFee, tournamentId);
            }
        }

        tournament.winner = winnerId;
        tournament.status = "COMPLETED";
        await tournament.save();

        const User = require("../models/User");
        await User.findByIdAndUpdate(winnerId, {
            $inc: { "playerStats.tournamentWon": 1 }
        });

        logger.info("Tournament " + tournamentId + " completed. Winner: " + winnerId + ", Prize: " + tournament.prizePool);

        // Auto-create next tournament so there's always one open
        this.ensureActiveTournament().catch(err => {
            logger.error("Failed to auto-create next tournament:", err);
        });

        return tournament;
    }

    /**
     * Cancel a tournament (admin only) - refund all players
     */
    async cancelTournament(tournamentId) {
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error("Tournament not found");
        if (tournament.status === "COMPLETED" || tournament.status === "CANCELLED") {
            throw new Error("Tournament already ended");
        }

        for (const player of tournament.players) {
            try {
                await WalletService.cancelGame(player.userId, tournament.entryFee, tournamentId);
            } catch (err) {
                logger.error("Failed to refund player " + player.userId + " in tournament " + tournamentId + ":", err);
            }
        }

        await Match.updateMany(
            { tournamentId: tournament._id, state: "RUNNING" },
            { state: "CANCELLED" }
        );

        tournament.status = "CANCELLED";
        await tournament.save();

        logger.info("Tournament " + tournamentId + " cancelled, " + tournament.players.length + " players refunded");

        // Auto-create next tournament so there's always one open
        this.ensureActiveTournament().catch(err => {
            logger.error("Failed to auto-create next tournament after cancel:", err);
        });

        return tournament;
    }

    /**
     * Get tournament details
     */
    async getTournament(tournamentId) {
        const tournament = await Tournament.findById(tournamentId)
            .populate("players.userId", "_id fullName avatar playerStats")
            .populate("winner", "_id fullName avatar")
            .populate("rounds.matches.matchId")
            .populate("rounds.matches.winner", "_id fullName avatar");

        if (!tournament) throw new Error("Tournament not found");
        return tournament;
    }

    /**
     * List tournaments
     */
    async listTournaments({ status, page = 1, limit = 10 }) {
        const query = {};
        if (status) query.status = status;

        const tournaments = await Tournament.find(query)
            .populate("winner", "_id fullName avatar")
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const total = await Tournament.countDocuments(query);

        return {
            tournaments,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) }
        };
    }
}

module.exports = new TournamentService();

const TournamentService = require("../services/tournament.service");

class TournamentController {

    // Get the currently active tournament (REGISTRATION state)
    async getActive(req, res) {
        try {
            const tournaments = await TournamentService.getActiveTournaments();
            return res.status(200).json({ success: true, data: tournaments });
        } catch (error) {
            console.error("Get Active Tournament Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Player: Register for tournament
    async register(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user._id;

            const { tournament, shouldStart } = await TournamentService.registerPlayer(userId, id);

            if (shouldStart) {
                // Start tournament asynchronously
                TournamentService.startTournament(tournament._id)
                    .then(async (started) => {
                        if (global.io) {
                            const semiFinalRound = started.rounds.find(r => r.roundNumber === 1);
                            if (semiFinalRound) {
                                const Match = require("../models/Match");
                                for (const matchEntry of semiFinalRound.matches) {
                                    const match = await Match.findById(matchEntry.matchId);
                                    if (!match) continue;

                                    match.players.forEach(p => {
                                        global.io.to(`user:${p.userId}`).emit("tournament:started", {
                                            tournamentId: started._id,
                                            matchId: match._id,
                                            tableNumber: matchEntry.tableNumber,
                                            color: p.color,
                                            message: "Tournament started! Join your table."
                                        });
                                    });
                                }
                            }
                        }
                    })
                    .catch(err => console.error("Tournament start error:", err));
            }

            // Broadcast registration update
            if (global.io) {
                global.io.emit("tournament:playerRegistered", {
                    tournamentId: tournament._id,
                    playersCount: tournament.players.length,
                    players: tournament.players,
                    winner: tournament.winner,
                    maxPlayers: tournament.maxPlayers
                });
            }

            return res.status(200).json({
                success: true,
                message: shouldStart ? "Registered! Tournament starting..." : "Registered successfully",
                data: {
                    tournamentId: tournament._id,
                    playersCount: tournament.players.length,
                    maxPlayers: tournament.maxPlayers,
                    status: tournament.status
                }
            });
        } catch (error) {
            console.error("Register Tournament Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Get tournament details by ID
    async getById(req, res) {
        try {
            const tournament = await TournamentService.getTournament(req.params.id);
            return res.status(200).json({ success: true, data: tournament });
        } catch (error) {
            console.error("Get Tournament Error:", error);
            return res.status(404).json({ success: false, message: error.message });
        }
    }

    // List tournaments
    async list(req, res) {
        try {
            const { status, page, limit } = req.query;
            const result = await TournamentService.listTournaments({
                status,
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 10
            });
            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            console.error("List Tournaments Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Cancel tournament
    async cancel(req, res) {
        try {
            const tournament = await TournamentService.cancelTournament(req.params.id);

            if (global.io) {
                tournament.players.forEach(p => {
                    global.io.to(`user:${p.userId}`).emit("tournament:cancelled", {
                        tournamentId: tournament._id,
                        message: "Tournament cancelled. Entry fee refunded."
                    });
                });
            }

            return res.status(200).json({
                success: true,
                message: "Tournament cancelled, all players refunded",
                data: tournament
            });
        } catch (error) {
            console.error("Cancel Tournament Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new TournamentController();

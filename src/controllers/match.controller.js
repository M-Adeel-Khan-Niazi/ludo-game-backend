const MatchService = require("../services/match.service");
const Match = require("../models/Match");

class MatchController {

    // Create specific match (Private or specific config)
    async create(req, res) {
        try {
            const { color, gameType, joiningFee, isPrivate = false } = req.body;
            const userId = req.user._id;

            if (!joiningFee && joiningFee !== 0) return res.status(400).json({ message: "Joining fee required" });

            const match = await MatchService.createMatchAndJoin(userId, color, gameType, joiningFee, isPrivate);

            return res.status(201).json({
                success: true,
                message: "Match created successfully",
                data: match
            });
        } catch (error) {
            console.error("Create Match Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Join via Room Code (Private) or Match ID
    async join(req, res) {
        try {
            const { matchId, roomCode } = req.body;
            const userId = req.user._id;

            let matchToJoinId = matchId;

            if (!matchToJoinId && roomCode) {
                // Find match by code
                const found = await Match.findOne({ roomCode, state: "WAITING" });
                if (!found) return res.status(404).json({ message: "Invalid Room Code" });
                matchToJoinId = found._id;
            }

            if (!matchToJoinId) return res.status(400).json({ message: "MatchID or RoomCode required" });

            const match = await MatchService.joinMatch(userId, matchToJoinId);

            return res.status(200).json({
                success: true,
                message: "Joined match successfully",
                data: match
            });

        } catch (error) {
            console.error("Join Match Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }


    // Quick Play / Matchmaking
    async findPubic(req, res) {
        try {
            const { gameType, joiningFee } = req.body;
            const userId = req.user._id;

            // Logic: Find existing or Create new
            const match = await MatchService.findAndJoin(userId, gameType, joiningFee);

            return res.status(200).json({
                success: true,
                message: match.players.length === match.maxPlayers ? "Match Started" : "Waiting for players",
                data: match
            });
        } catch (error) {
            console.error("Find Match Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Check if user is in an active game
    async getUserGameStatus(req, res) {
        try {
            const userId = req.user._id;
            const result = await MatchService.getUserGameStatus(userId);

            return res.status(200).json({
                success: true,
                message: "User status fetched",
                userStatus: result.userStatus, // "IN_GAME", "REGISTERED", "IN_TOURNAMENT", "IDLE", "COMPLETED"
                data: result.data
            });
        } catch (error) {
            console.error("Get Active Match Error:", error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new MatchController();

const MatchService = require("../services/match.service");
const Match = require("../models/Match");

class MatchController {

    // Create specific match (Private or specific config)
    async create(req, res) {
        try {
            const { color, gameType, joiningFee, isPrivate = false, difficultyTier } = req.body;
            const userId = req.user._id;

            if (!joiningFee && joiningFee !== 0) return res.status(400).json({ message: "Joining fee required" });

            const match = await MatchService.createMatchAndJoin(userId, color, gameType, joiningFee, isPrivate, undefined, difficultyTier);

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
            const { gameType, joiningFee, difficultyTier } = req.body;
            const userId = req.user._id;

            // Logic: Find existing or Create new
            const match = await MatchService.findAndJoin(userId, gameType, joiningFee, difficultyTier);

            let message = "Match Started";
            if (match.state !== "RUNNING") {
                message = match.isVsBot
                    ? "Bots joined — connect via socket to play"
                    : "Waiting for opponents (bots fill empty slots after a short delay)";
            }

            return res.status(200).json({
                success: true,
                message,
                data: match
            });
        } catch (error) {
            console.error("Find Match Error:", error);
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // Practice Mode — play against bots, 0 fee, bypasses BOT_ENABLED
    async practice(req, res) {
        try {
            const { gameType, difficultyTier } = req.body;
            const userId = req.user._id;

            if (!gameType) return res.status(400).json({ success: false, message: "gameType is required" });

            const validTypes = ["1V1", "4P", "2V2"];
            if (!validTypes.includes(gameType.toUpperCase())) {
                return res.status(400).json({ success: false, message: "Invalid gameType. Must be 1V1, 4P, or 2V2" });
            }

            const match = await MatchService.createPracticeMatch(userId, gameType.toUpperCase(), difficultyTier || "BRONZE");

            return res.status(201).json({
                success: true,
                message: "Practice match started — playing against bots",
                data: match
            });
        } catch (error) {
            console.error("Practice Match Error:", error);
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

    // Get joining fee against a room code
    async getRoomFee(req, res) {
        try {
            const { roomCode } = req.body;

            if (!roomCode) {
                return res.status(400).json({ success: false, message: "Room code is required" });
            }

            const match = await Match.findOne({ roomCode });
            
            if (!match) {
                return res.status(404).json({ success: false, message: "Room not found!" });
            }
            
            if (match.state !== "WAITING") {
                return res.status(400).json({ success: false, message: "Match has already started or ended" });
            }

            return res.status(200).json({
                success: true,
                message: "Room joining fee fetched successfully",
                data: { joiningFee: match.joiningFee, gameType: match.gameType }
            });
        } catch (error) {
            console.error("Get Room Fee Error:", error);
            return res.status(500).json({ success: false, message: error.message });
        }
    }
}

module.exports = new MatchController();

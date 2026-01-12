const express = require("express");
const router = express.Router();
const MatchController = require("../../controllers/match.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

// Create match
router.post("/create", authenticateJwt, MatchController.create.bind(MatchController));

// Find public match (Auto Join)
router.post("/find", authenticateJwt, MatchController.findPubic.bind(MatchController));

// Join specific match (by RoomCode or ID)
router.post("/join", authenticateJwt, MatchController.join.bind(MatchController));


module.exports = router;

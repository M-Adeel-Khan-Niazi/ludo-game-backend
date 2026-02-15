const express = require("express");
const router = express.Router();
const TournamentController = require("../../controllers/tournament.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

// Get the currently active tournament (open for registration)
router.get("/active", authenticateJwt, TournamentController.getActive.bind(TournamentController));

// List tournaments (with optional ?status= filter)
router.get("/", authenticateJwt, TournamentController.list.bind(TournamentController));

// Get tournament details by ID
router.get("/:id", authenticateJwt, TournamentController.getById.bind(TournamentController));

// Register for tournament
router.post("/:id/register", authenticateJwt, TournamentController.register.bind(TournamentController));

// Cancel tournament
router.post("/:id/cancel", authenticateJwt, TournamentController.cancel.bind(TournamentController));

module.exports = router;

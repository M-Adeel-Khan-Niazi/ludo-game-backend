const express = require("express");
const router = express.Router();
const supportController = require("../../controllers/support.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

// Routes
router.post("/", authenticateJwt, supportController.createTicket.bind(supportController));
router.get("/", authenticateJwt, supportController.getAllTickets.bind(supportController));
router.get("/:id", authenticateJwt, supportController.getTicketById.bind(supportController));
router.post("/:id/reply", authenticateJwt, supportController.replyToTicket.bind(supportController));
router.patch("/:id/status", authenticateJwt, supportController.updateTicketStatus.bind(supportController));

module.exports = router;

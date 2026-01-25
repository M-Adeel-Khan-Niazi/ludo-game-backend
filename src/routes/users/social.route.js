const express = require("express");
const router = express.Router();
const socialController = require("../../controllers/social.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

// Friend Requests
router.post("/friend-request", authenticateJwt, socialController.sendFriendRequest.bind(socialController));
router.post("/friend-request/:requestId/accept", authenticateJwt, socialController.acceptFriendRequest.bind(socialController));
router.get("/friend-requests", authenticateJwt, socialController.getFriendRequests.bind(socialController));

// Friend List
router.get("/friends", authenticateJwt, socialController.getFriendList.bind(socialController));

// Block/Unblock
router.post("/block", authenticateJwt, socialController.blockUser.bind(socialController));
router.post("/unblock", authenticateJwt, socialController.unblockUser.bind(socialController));

// Report
router.post("/report", authenticateJwt, socialController.reportUser.bind(socialController));
router.post("/report-message", authenticateJwt, socialController.reportMessage.bind(socialController));

module.exports = router;

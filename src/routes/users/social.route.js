const express = require("express");
const router = express.Router();
const socialController = require("../../controllers/social.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

// User Profile (with Friend Status)
router.get("/profile/:targetUserId", authenticateJwt, socialController.getUserProfile.bind(socialController));

// Friend Management (Add, Cancel, Accept, Reject, Remove)
router.post("/friend-action", authenticateJwt, socialController.manageFriend.bind(socialController));

// Friend Requests Lists
router.get("/friend-requests", authenticateJwt, socialController.getFriendRequests.bind(socialController));
router.get("/friend-requests/sent", authenticateJwt, socialController.getSentFriendRequests.bind(socialController));

// Friend List
router.get("/friends", authenticateJwt, socialController.getFriendList.bind(socialController));

// Block/Unblock
router.get("/blocked-users", authenticateJwt, socialController.getBlockedUsers.bind(socialController));
router.post("/block", authenticateJwt, socialController.blockUser.bind(socialController));
router.post("/unblock", authenticateJwt, socialController.unblockUser.bind(socialController));

// Gifts
router.post("/send-coins", authenticateJwt, socialController.sendCoins.bind(socialController));

// Report
router.post("/report", authenticateJwt, socialController.reportUser.bind(socialController));
router.post("/report-message", authenticateJwt, socialController.reportMessage.bind(socialController));

module.exports = router;

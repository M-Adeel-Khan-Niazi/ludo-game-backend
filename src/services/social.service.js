const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");
const Report = require("../models/Report");
const { handlers } = require("../utils/response-handlers");

class SocialService {

    // --- Friends ---

    async sendFriendRequest(req, res) {
        try {
            const { targetUserId } = req.body;
            const userId = req.user._id;

            if (userId.toString() === targetUserId) {
                return handlers.response.badRequest({ res, message: "Cannot invite yourself" });
            }

            // Check if already friends
            const user = await User.findById(userId);
            if (user.friends.includes(targetUserId)) {
                return handlers.response.badRequest({ res, message: "Already friends" });
            }

            // Check for existing pending request (either direction)
            const existing = await FriendRequest.findOne({
                $or: [
                    { sender: userId, receiver: targetUserId, status: "pending" },
                    { sender: targetUserId, receiver: userId, status: "pending" },
                ],
            });

            if (existing) {
                return handlers.response.badRequest({ res, message: "Friend request already pending" });
            }

            const request = await FriendRequest.create({
                sender: userId,
                receiver: targetUserId,
            });

            return handlers.response.success({
                res,
                message: "Friend request sent",
                data: request,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async acceptFriendRequest(req, res) {
        try {
            const { requestId } = req.params;
            const userId = req.user._id;

            const request = await FriendRequest.findById(requestId);

            if (!request) {
                return handlers.response.notFound({ res, message: "Request not found" });
            }

            if (request.receiver.toString() !== userId.toString()) {
                return handlers.response.unauthorized({ res, message: "Not authorized to accept this request" });
            }

            if (request.status !== "pending") {
                return handlers.response.badRequest({ res, message: "Request already processed" });
            }

            request.status = "accepted";
            await request.save();

            // Update both users friend lists
            await User.findByIdAndUpdate(request.sender, { $addToSet: { friends: request.receiver } });
            await User.findByIdAndUpdate(request.receiver, { $addToSet: { friends: request.sender } });

            return handlers.response.success({
                res,
                message: "Friend request accepted",
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async getFriendList(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId).populate("friends", "fullName userName avatar email");

            return handlers.response.success({
                res,
                data: user.friends,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async getFriendRequests(req, res) {
        try {
            const userId = req.user._id;
            // Requests received by me
            const requests = await FriendRequest.find({
                receiver: userId,
                status: "pending",
            }).populate("sender", "fullName userName avatar");

            return handlers.response.success({
                res,
                data: requests,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // --- Block / Unblock ---

    async blockUser(req, res) {
        try {
            const { targetUserId } = req.body;
            const userId = req.user._id;

            await User.findByIdAndUpdate(userId, { $addToSet: { blockedUsers: targetUserId } });

            // Optional: Remove from friends if blocked?
            // const user = await User.findById(userId);
            // if (user.friends.includes(targetUserId)) ...

            return handlers.response.success({
                res,
                message: "User blocked successfully",
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async unblockUser(req, res) {
        try {
            const { targetUserId } = req.body;
            const userId = req.user._id;

            await User.findByIdAndUpdate(userId, { $pull: { blockedUsers: targetUserId } });

            return handlers.response.success({
                res,
                message: "User unblocked successfully",
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // --- Report ---

    async reportUser(req, res) {
        try {
            const { reportedUserId, reason, description } = req.body;
            const userId = req.user._id;

            const report = await Report.create({
                reporter: userId,
                reportedUser: reportedUserId,
                reason,
                description,
            });

            return handlers.response.success({
                res,
                message: "User reported successfully",
                data: report,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async reportMessage(req, res) {
        try {
            // Need ChatMessage model here? Maybe require at top, or inside.
            // Assuming Report model already imported.
            const ChatMessage = require("../models/ChatMessage");

            const { messageId, reason, description } = req.body;
            const userId = req.user._id;

            const message = await ChatMessage.findById(messageId);
            if (!message) {
                return handlers.response.notFound({ res, message: "Message not found" });
            }

            const report = await Report.create({
                reporter: userId,
                reportedUser: message.sender, // The sender of the message
                reportedMessage: messageId,
                reason,
                description,
            });

            return handlers.response.success({
                res,
                message: "Message reported successfully",
                data: report,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }
}

module.exports = new SocialService();

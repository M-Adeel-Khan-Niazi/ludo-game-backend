const mongoose = require("mongoose");
const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");
const Report = require("../models/Report");
const WalletTransaction = require("../models/WalletTransaction");
const { handlers } = require("../utils/response-handlers");

class SocialService {

    // --- Profile & Status ---

    async getUserProfile(req, res) {
        try {
            const userId = req.user._id;
            const { targetUserId } = req.params;

            // Fetch target user and current user
            const [targetUser, me] = await Promise.all([
                User.findById(targetUserId).select("fullName userName avatar playerStats blockedUsers isBot"),
                User.findById(userId).select("blockedUsers")
            ]);

            if (!targetUser) {
                return handlers.response.unavailable({ res, message: "User not found" });
            }

            let connectionStatus = "add"; // Default

            // Check if I have blocked the target user
            const iBlockedTarget = me.blockedUsers && me.blockedUsers.some(id => id.toString() === targetUserId.toString());
            // Check if target has blocked me
            const targetBlockedMe = targetUser.blockedUsers && targetUser.blockedUsers.some(id => id.toString() === userId.toString());

            if (iBlockedTarget) {
                connectionStatus = "blocked";
            } else if (targetBlockedMe) {
                connectionStatus = "restricted";
            } else {
                // Check Friend Request Status
                const request = await FriendRequest.findOne({
                    $or: [
                        { sender: userId, receiver: targetUserId },
                        { sender: targetUserId, receiver: userId }
                    ]
                });

                if (request) {
                    if (request.status === "accepted") {
                        connectionStatus = "accepted";
                    } else if (request.status === "pending") {
                        if (request.sender.toString() === userId.toString()) {
                            connectionStatus = "outgoingPending";
                        } else {
                            connectionStatus = "incomingPending";
                        }
                    }
                }
            }

            // Remove blockedUsers from response data
            const targetUserData = targetUser.toObject();
            delete targetUserData.blockedUsers;

            // If target is a bot, return a restricted connectionStatus so frontend can hide social actions
            if (targetUser.isBot) {
                connectionStatus = "restricted";
            }

            return handlers.response.success({
                res,
                data: { ...targetUserData, connectionStatus }
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // --- Friend Management ---

    async manageFriend(req, res) {
        try {
            const { targetUserId, action } = req.body;
            const userId = req.user._id;

            if (userId.toString() === targetUserId) {
                return handlers.response.failed({ res, message: "Cannot perform action on yourself" });
            }

            // Block social actions on bot users
            const targetIsBot = await User.findById(targetUserId).select("isBot");
            if (targetIsBot && targetIsBot.isBot) {
                return handlers.response.failed({ res, message: "Cannot perform this action on a bot" });
            }

            // Check if target blocks me
            const targetUser = await User.findById(targetUserId).select("blockedUsers");
            if (!targetUser) return handlers.response.unavailable({ res, message: "User not found" });
            if (targetUser.blockedUsers && targetUser.blockedUsers.includes(userId)) {
                return handlers.response.failed({ res, message: "User has restricted access" });
            }

            // Check for existing relationship
            const request = await FriendRequest.findOne({
                $or: [
                    { sender: userId, receiver: targetUserId },
                    { sender: targetUserId, receiver: userId }
                ]
            });

            // Action: ADD
            if (action === "add") {
                if (request) {
                    if (request.status === "accepted") return handlers.response.failed({ res, message: "Already friends" });
                    if (request.status === "pending") {
                        if (request.sender.toString() === userId.toString()) {
                            return handlers.response.failed({ res, message: "Request already pending" });
                        } else {
                            return handlers.response.failed({ res, message: "User has already sent you a request. Please accept it." });
                        }
                    }
                }
                const newRequest = await FriendRequest.create({ sender: userId, receiver: targetUserId, status: "pending" });
                return handlers.response.success({ res, message: "Friend request sent", data: newRequest });
            }

            if (!request) {
                if (action === "cancel") return handlers.response.unavailable({ res, message: "Request not found or already rejected" });
                return handlers.response.unavailable({ res, message: "No relationship found!" });
            }

            // Action: CANCEL (Sender cancels pending)
            if (action === "cancel") {
                if (request.status === "accepted") return handlers.response.failed({ res, message: "Friend request already accepted" });
                if (request.status !== "pending" || request.sender.toString() !== userId.toString()) return handlers.response.failed({ res, message: "Cannot cancel" });
                await FriendRequest.findByIdAndDelete(request._id);
                return handlers.response.success({ res, message: "Request cancelled" });
            }

            // Action: ACCEPT (Receiver accepts pending)
            if (action === "accept") {
                if (request.status !== "pending" || request.receiver.toString() !== userId.toString()) return handlers.response.failed({ res, message: "Cannot accept" });
                request.status = "accepted";
                await request.save();

                // Update Users Friends Array
                await User.findByIdAndUpdate(userId, { $addToSet: { friends: targetUserId } });
                await User.findByIdAndUpdate(targetUserId, { $addToSet: { friends: userId } });

                return handlers.response.success({ res, message: "Request accepted" });
            }

            // Action: REJECT (Receiver rejects pending)
            if (action === "reject") {
                if (request.status !== "pending" || request.receiver.toString() !== userId.toString()) return handlers.response.failed({ res, message: "Cannot reject" });
                await FriendRequest.findByIdAndDelete(request._id);
                return handlers.response.success({ res, message: "Request rejected" });
            }

            // Action: REMOVE (Unfriend)
            if (action === "remove") {
                if (request.status !== "accepted") return handlers.response.failed({ res, message: "Not friends" });
                await FriendRequest.findByIdAndDelete(request._id);

                // Update Users Friends Array
                await User.findByIdAndUpdate(userId, { $pull: { friends: targetUserId } });
                await User.findByIdAndUpdate(targetUserId, { $pull: { friends: userId } });

                return handlers.response.success({ res, message: "Friend removed" });
            }

            return handlers.response.failed({ res, message: "Invalid action" });

        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async getFriendList(req, res) {
        try {
            const userId = req.user._id;
            
            // Find accepted requests where I am sender OR receiver
            const requests = await FriendRequest.find({
                $or: [{ sender: userId }, { receiver: userId }],
                status: "accepted"
            }).populate("sender receiver", "fullName userName avatar");

            // Map to get the OTHER user
            const friends = requests.map(r => {
                const friend = r.sender._id.toString() === userId.toString() ? r.receiver : r.sender;
                return { ...friend.toObject(), connectionStatus: "accepted" };
            });

            return handlers.response.success({
                res,
                data: friends
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

            const data = requests.map(r => {
                if (!r.sender) return null;
                return { ...r.sender.toObject(), connectionStatus: "incomingPending" };
            }).filter(Boolean);

            return handlers.response.success({
                res,
                data: data,
            });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async getSentFriendRequests(req, res) {
        try {
            const userId = req.user._id;
            const requests = await FriendRequest.find({
                sender: userId,
                status: "pending",
            }).populate("receiver", "fullName userName avatar");

            const data = requests.map(r => {
                if (!r.receiver) return null;
                return { ...r.receiver.toObject(), connectionStatus: "outgoingPending" };
            }).filter(Boolean);

            return handlers.response.success({ res, data: data });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    // --- Block / Unblock ---

    async getBlockedUsers(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId).populate("blockedUsers", "fullName userName avatar");

            const blockedUsers = user.blockedUsers.map(u => ({
                ...u.toObject(),
                connectionStatus: "blocked"
            }));

            return handlers.response.success({ res, data: blockedUsers });
        } catch (error) {
            return handlers.response.error({ res, error, message: error.message });
        }
    }

    async blockUser(req, res) {
        try {
            const { targetUserId } = req.body;
            const userId = req.user._id;

            // Block social actions on bot users
            const targetIsBot = await User.findById(targetUserId).select("isBot");
            if (targetIsBot && targetIsBot.isBot) {
                return handlers.response.failed({ res, message: "Cannot perform this action on a bot" });
            }

            // Add to blocked list AND remove from friends list
            await User.findByIdAndUpdate(userId, { 
                $addToSet: { blockedUsers: targetUserId },
                $pull: { friends: targetUserId }
            });

            // Also remove me from their friends list
            await User.findByIdAndUpdate(targetUserId, { $pull: { friends: userId } });

            // Remove any existing relationship (friendship or pending request)
            await FriendRequest.findOneAndDelete({
                $or: [
                    { sender: userId, receiver: targetUserId },
                    { sender: targetUserId, receiver: userId }
                ]
            });

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

    // --- Gifts / Coins ---

    async sendCoins(req, res) {
        try {
            const { targetUserId, amount } = req.body;
            const userId = req.user._id;

            if (userId.toString() === targetUserId) {
                return handlers.response.failed({ res, message: "Cannot send coins to yourself" });
            }

            // Block social actions on bot users
            const targetIsBot = await User.findById(targetUserId).select("isBot");
            if (targetIsBot && targetIsBot.isBot) {
                return handlers.response.failed({ res, message: "Cannot send coins to a bot" });
            }

            if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
                return handlers.response.failed({ res, message: "Invalid user ID" });
            }

            const coinsToSend = Number(amount);

            // 1. Preset Amount Validation
            const validAmounts = [5, 10, 25, 50, 100, 200];
            if (!validAmounts.includes(coinsToSend)) {
                return handlers.response.failed({ res, message: "Invalid amount. Allowed values: 5, 10, 25, 50, 100, 200" });
            }

            // Time window: Start of current day
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            // 2. Daily Send Limit (Per Target User) - Max 10 times
            const sentCount = await WalletTransaction.countDocuments({
                userId: userId,
                type: "GIFT_SENT",
                relatedUserId: targetUserId,
                createdAt: { $gte: startOfDay }
            });

            if (sentCount >= 10) {
                return handlers.response.failed({ res, message: "You have reached your daily gift limit." });
            }

            // 3. Daily Receive Limit (Global) - Max 1000 coins
            const receivedStats = await WalletTransaction.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(targetUserId),
                        type: "GIFT_RECEIVED",
                        createdAt: { $gte: startOfDay }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalReceived: { $sum: "$amount" }
                    }
                }
            ]);

            const currentReceived = receivedStats.length > 0 ? receivedStats[0].totalReceived : 0;

            if (currentReceived + coinsToSend > 1000) {
                return handlers.response.failed({ res, message: "User has reached their daily gift limit of coins." });
            }

            // Check if receiver exists
            const receiver = await User.findById(targetUserId);
            if (!receiver) {
                return handlers.response.unavailable({ res, message: "Receiver not found" });
            }

            // Atomically check balance and deduct coins
            const sender = await User.findOneAndUpdate(
                { _id: userId, "wallet.coins": { $gte: coinsToSend } },
                { $inc: { "wallet.coins": -coinsToSend } },
                { new: true }
            );

            if (!sender) {
                return handlers.response.failed({ res, message: "Insufficient coins" });
            }

            // Add coins to receiver
            const updatedReceiver = await User.findByIdAndUpdate(targetUserId, {
                $inc: { "wallet.coins": coinsToSend }
            }, { new: true });

            // Create Transaction Records
            await WalletTransaction.create({
                userId: userId,
                type: "GIFT_SENT",
                amount: -coinsToSend,
                balanceAfter: sender.wallet.coins,
                relatedUserId: targetUserId,
                description: `Sent gift to ${receiver.userName || 'user'}`
            });

            await WalletTransaction.create({
                userId: targetUserId,
                type: "GIFT_RECEIVED",
                amount: coinsToSend,
                balanceAfter: updatedReceiver.wallet.coins,
                relatedUserId: userId,
                description: `Received gift from ${sender.userName || 'user'}`
            });

            return handlers.response.success({
                res,
                message: `Successfully sent ${coinsToSend} coins`,
                data: { currentCoins: sender.wallet.coins }
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

            // Block social actions on bot users
            const targetIsBot = await User.findById(reportedUserId).select("isBot");
            if (targetIsBot && targetIsBot.isBot) {
                return handlers.response.failed({ res, message: "Cannot report a bot" });
            }

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
                return handlers.response.unavailable({ res, message: "Message not found" });
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

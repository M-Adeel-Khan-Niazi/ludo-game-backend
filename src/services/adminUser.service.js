const User = require("../models/User");
const Match = require("../models/Match");
const Transaction = require("../models/WalletTransaction");

class AdminUserService {
    /**
     * List all users with pagination and search
     */
    async listUsers(page = 1, limit = 10, search = "") {
        const query = { isDeleted: false, role: "user" };

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { phoneNumber: { $regex: search, $options: "i" } },
            ];
        }

        const skip = (page - 1) * limit;
        const total = await User.countDocuments(query);
        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        return {
            users,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Get user details by ID
     */
    async getUserDetail(userId) {
        const user = await User.findOne({ _id: userId, isDeleted: false });
        if (!user) throw new Error("User not found");
        return user;
    }

    async getUserMatches(userId) {
        const matches = await Match.find({
            "players.userId": userId
        }).populate("players.userId", "_id fullName avatar isBot");
        return matches;
    }

    /**
     * Toggle user's isActive status
     */
    async toggleUserStatus(userId) {
        const user = await User.findOne({ _id: userId, isDeleted: false });
        if (!user) throw new Error("User not found");

        user.isActive = !user.isActive;
        await user.save();
        return user;
    }

    /**
     * Soft delete a user
     */
    async softDeleteUser(userId) {
        const user = await User.findOne({ _id: userId, isDeleted: false });
        if (!user) throw new Error("User not found");

        user.isDeleted = true;
        await user.save();
        return { message: "User soft deleted successfully" };
    }
}

module.exports = new AdminUserService();

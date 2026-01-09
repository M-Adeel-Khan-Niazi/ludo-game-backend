const WalletService = require("../services/wallet.service");
const User = require("../models/User");

class WalletController {

    /**
     * Get wallet history for the logged-in user
     * GET /api/wallet/history?page=1&limit=10
     */
    async getHistory(req, res) {
        try {
            const { page = 1, limit = 10 } = req.query;
            const userId = req.user._id;

            const history = await WalletService.getWalletHistory(userId, parseInt(page), parseInt(limit));

            return res.status(200).json({
                success: true,
                data: history
            });
        } catch (error) {
            console.error("Error getting wallet history:", error);
            return res.status(500).json({
                success: false,
                message: "Internal server error"
            });
        }
    }

    /**
     * Get current wallet balance
     * GET /api/wallet/balance
     */
    async getBalance(req, res) {
        try {
            const userId = req.user._id;
            const user = await User.findById(userId).select("wallet");

            if (!user) {
                return res.status(404).json({ success: false, message: "User not found" });
            }

            return res.status(200).json({
                success: true,
                data: user.wallet
            });
        } catch (error) {
            console.error("Error getting wallet balance:", error);
            return res.status(500).json({ success: false, message: "Internal Server Error" });
        }
    }

    // NOTE: joinGame, cancelGame, settleGame are usually called internally by MatchController.
    // We generally do NOT expose them as public APIs to prevent users from arbitrarily joining/claiming wins.
    // However, for testing purposes or admin panel, we might expose them protected by strict middleware.
    // For now, I will stick to read-only endpoints for the user.
}

module.exports = new WalletController();

const mongoose = require("mongoose");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");

class WalletService {
    /**
     * Helper to execute a transaction
     * @param {Function} operation - Async function receiving session
     */
    async withTransaction(operation) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const result = await operation(session);
            await session.commitTransaction();
            return result;
        } catch (error) {
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Lock coins when joining a game
     * @param {String} userId
     * @param {Number} amount
     * @param {String} matchId
     */
    async joinGame(userId, amount, matchId) {
        return this.withTransaction(async (session) => {
            const user = await User.findById(userId).session(session);
            if (!user) throw new Error("User not found");

            if (user.wallet.coins < amount) {
                throw new Error("Insufficient balance");
            }

            // Deduct from main balance, add to locked
            user.wallet.coins -= amount;
            user.wallet.lockedCoins += amount;
            await user.save({ session });

            // Create transaction record
            await WalletTransaction.create(
                [
                    {
                        userId,
                        type: "GAME_JOIN",
                        amount: -amount,
                        balanceAfter: user.wallet.coins,
                        matchId,
                        description: `Joined game ${matchId}`,
                    },
                ],
                { session }
            );

            return user.wallet;
        });
    }

    /**
     * Unlock coins if game is cancelled (Refund)
     * @param {String} userId
     * @param {Number} amount
     * @param {String} matchId
     */
    async cancelGame(userId, amount, matchId) {
        return this.withTransaction(async (session) => {
            const user = await User.findById(userId).session(session);
            if (!user) throw new Error("User not found");

            if (user.wallet.lockedCoins < amount) {
                // This simulates a critical data integrity issue or race condition fix
                // In practice, we might just unlock whatever is there or throw
                throw new Error("Insufficient locked coins to unlock");
            }

            // Reverse operation
            user.wallet.lockedCoins -= amount;
            user.wallet.coins += amount;
            await user.save({ session });

            await WalletTransaction.create(
                [
                    {
                        userId,
                        type: "GAME_REFUND",
                        amount: amount,
                        balanceAfter: user.wallet.coins,
                        matchId,
                        description: `Game ${matchId} cancelled, refund`,
                    },
                ],
                { session }
            );

            return user.wallet;
        });
    }

    /**
     * Settle game: Distribute winnings.
     * NOTE: This assumes the 'amount' is the total winning amount to BE ADDED.
     * The entry fee was already locked and (conceptually) consumed or needs to be removed from locked.
     *
     * Strategy:
     * 1. Remove locked coins (they are "spent" on the game).
     * 2. Add winning amount to actual coins.
     *
     * @param {String} userId - Winner ID
     * @param {Number} lockedAmount - The amount this user had locked (entry fee)
     * @param {Number} winningAmount - The total amount to credit (entry + profit)
     * @param {String} matchId
     */
    async settleWin(userId, lockedAmount, winningAmount, matchId) {
        return this.withTransaction(async (session) => {
            const user = await User.findById(userId).session(session);
            if (!user) throw new Error("User not found");

            // 1. Burn the locked coins (they are gone into the pot)
            if (user.wallet.lockedCoins < lockedAmount) {
                // Fallback if something is weird, but ideally strict check
                // For robustness, we can zero it out or just deduct
                user.wallet.lockedCoins = Math.max(0, user.wallet.lockedCoins - lockedAmount);
            } else {
                user.wallet.lockedCoins -= lockedAmount;
            }

            // 2. Add winnings
            user.wallet.coins += winningAmount;
            await user.save({ session });

            await WalletTransaction.create(
                [
                    {
                        userId,
                        type: "GAME_WIN",
                        amount: winningAmount, // Net positive flow to balance
                        balanceAfter: user.wallet.coins,
                        matchId,
                        description: `Won game ${matchId}`,
                    },
                ],
                { session }
            );

            return user.wallet;
        });
    }

    /**
     * Settle game: Handle Loss
     * Just remove the locked coins.
     */
    async settleLoss(userId, lockedAmount, matchId) {
        return this.withTransaction(async (session) => {
            const user = await User.findById(userId).session(session);
            if (!user) throw new Error("User not found");

            if (user.wallet.lockedCoins >= lockedAmount) {
                user.wallet.lockedCoins -= lockedAmount;
            } else {
                user.wallet.lockedCoins = 0; // or handle error
            }

            await user.save({ session });

            await WalletTransaction.create([{
                userId,
                type: "GAME_LOSS",
                amount: -lockedAmount, // Technically it was already deducted from balance, but this tracks the event?
                // Actually, for history, the balance changed at JOIN. checking standard ledger practices.
                // Usually we show -Joinfee. If validation fails, we refund.
                // If lost, we just don't give back.
                // But we might want a record saying "Game Over - Lost".
                // The balance doesn't change here (it changed at join), but locked decreases.
                balanceAfter: user.wallet.coins,
                matchId,
                description: `Lost game ${matchId}`
            }], { session });

            return user.wallet;
        });
    }

    async getWalletHistory(userId, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const transactions = await WalletTransaction.find({ userId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate("matchId", "matchId status"); // simplistic populate

        const total = await WalletTransaction.countDocuments({ userId });

        return {
            transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }

    /**
     * Purchase a coin package
     * @param {String} userId
     * @param {String} packageId
     * @param {String} platform
     * @param {String} provider
     * @param {Number} amount
     * @param {String} amountType
     * @param {String} transactionId
     */
    async purchasePackage(userId, packageId, platform, provider, amount, amountType, transactionId) {
        return this.withTransaction(async (session) => {
            const CoinPackage = require("../models/CoinPackage");
            const CoinPurchase = require("../models/CoinPurchase");

            const user = await User.findById(userId).session(session);
            if (!user) throw new Error("User not found");

            const coinPackage = await CoinPackage.findById(packageId).session(session);
            if (!coinPackage) throw new Error("Package not found");
            if (!coinPackage.isActive) throw new Error("Package is not active");

            const totalCoins = coinPackage.coins + coinPackage.bonusCoins;

            // Update user wallet
            user.wallet.coins += totalCoins;
            await user.save({ session });

            // Create purchase record
            const purchase = await CoinPurchase.create(
                [
                    {
                        userId,
                        packageId,
                        platform,
                        coins: coinPackage.coins,
                        bonusCoins: coinPackage.bonusCoins,
                        amount,
                        amountType,
                        transactionId,
                        provider,
                        status: "SUCCESS",
                    },
                ],
                { session }
            );

            // Create wallet transaction record
            await WalletTransaction.create(
                [
                    {
                        userId,
                        type: "COIN_PURCHASE",
                        amount: totalCoins,
                        balanceAfter: user.wallet.coins,
                        description: `Purchased package: ${coinPackage.title}`,
                    },
                ],
                { session }
            );

            return {
                wallet: user.wallet,
                purchase: purchase[0]
            };
        });
    }

    /**
     * Get purchase history for a user (or all if admin)
     * @param {String} userId
     * @param {Number} page
     * @param {Number} limit
     * @param {String} search
     * @param {Boolean} isAdmin
     */
    async getPurchaseHistory(userId, page = 1, limit = 10, search = "", isAdmin = false) {
        const CoinPurchase = require("../models/CoinPurchase");
        const User = require("../models/User");
        const CoinPackage = require("../models/CoinPackage");

        const skip = (page - 1) * limit;
        let query = {};

        if (!isAdmin) {
            query.userId = userId;
        }

        if (search) {
            const regex = new RegExp(search, "i");

            // Find users matching search
            const users = await User.find({
                $or: [{ fullName: regex }, { userName: regex }, { email: regex }]
            }, "_id");
            const userIds = users.map(u => u._id);

            // Find packages matching search
            const packages = await CoinPackage.find({ title: regex }, "_id");
            const packageIds = packages.map(p => p._id);

            // Filter purchases by either user or package match
            if (isAdmin) {
                query.$or = [
                    { userId: { $in: userIds } },
                    { packageId: { $in: packageIds } },
                    { transactionId: regex }
                ];
            } else {
                // If not admin, restrict to their userId but allow searching package/transaction
                query.$and = [
                    { userId: userId },
                    {
                        $or: [
                            { packageId: { $in: packageIds } },
                            { transactionId: regex }
                        ]
                    }
                ];
            }
        }

        const purchases = await CoinPurchase.find(query)
            .populate("packageId")
            .populate("userId", "fullName userName email avatar")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await CoinPurchase.countDocuments(query);

        return {
            purchases,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    }
}

module.exports = new WalletService();

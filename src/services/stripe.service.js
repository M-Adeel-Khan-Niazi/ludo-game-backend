const stripe = require("stripe")(require("../config/env").STRIPE_SECRET_KEY);
const CoinPurchase = require("../models/CoinPurchase");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");

class StripeService {
    /**
     * Creates a PaymentIntent for purchasing a coin package.
     * For Web, if a token is provided, the intent can be confirmed immediately.
     *
     * @param {Object} coinPackage - The CoinPackage model instance.
     * @param {Object} user - The User model instance.
     * @param {String} platform - "ANDROID", "IOS", or "WEB"
     * @param {String} [token] - Stripe token (used for Web card flow)
     * @returns {Object} - result containing clientSecret, purchaseId, and status.
     */
    async createPaymentIntent(coinPackage, user, platform, token) {
        if (!["ANDROID", "IOS", "WEB"].includes(platform)) {
            throw new Error("Invalid platform specified.");
        }

        // Amount to charge (Stripe handles amounts in the smallest currency unit - cents)
        const amountInCents = Math.round(coinPackage.priceUSD * 100);

        const paymentIntentParams = {
            amount: amountInCents,
            currency: "usd",
            metadata: {
                userId: user._id.toString(),
                packageId: coinPackage._id.toString(),
                platform: platform,
            },
        };

        // If a token is provided (typically Web), use it and confirm immediately
        if (platform === "WEB" && token) {
            paymentIntentParams.payment_method_data = {
                type: "card",
                card: { token },
            };
            paymentIntentParams.confirm = true;
            paymentIntentParams.return_url = "https://portal.ludoroyalclub.com/payment/success";
            paymentIntentParams.automatic_payment_methods = { enabled: true, allow_redirects: "never" };
        }

        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);
        } catch (error) {
            console.error("Stripe Error creating payment intent:", error);
            throw new Error(`Stripe error: ${error.message}`);
        }

        // Create a pending purchase record
        const purchase = await CoinPurchase.create({
            userId: user._id,
            packageId: coinPackage._id,
            platform,
            coins: coinPackage.coins,
            bonusCoins: coinPackage.bonusCoins,
            amount: coinPackage.priceUSD,
            amountType: "USD",
            transactionId: paymentIntent.id,
            provider: "STRIPE",
            status: paymentIntent.status === "succeeded" ? "SUCCESS" : "PENDING",
        });

        // If Web with token succeeded immediately, grant coins now
        if (platform === "WEB" && token && paymentIntent.status === "succeeded") {
            await this.fulfillPurchase(purchase);
        }

        return {
            clientSecret: paymentIntent.client_secret,
            purchaseId: purchase._id,
            status: paymentIntent.status,
        };
    }

    /**
     * Handles Stripe Webhook events to securely grant coins.
     *
     * @param {Object} event - The Stripe webhook event.
     */
    async handleWebhook(event) {
        // We primarily care about successful payment intents
        if (event.type === "payment_intent.succeeded") {
            const paymentIntent = event.data.object;

            const purchase = await CoinPurchase.findOne({
                transactionId: paymentIntent.id,
            });

            if (!purchase || purchase.status === "SUCCESS") {
                // Already fulfilled or not found
                return;
            }

            await this.fulfillPurchase(purchase);
        }
    }

    /**
     * Fulfills a coin purchase by updating wallet and status.
     *
     * @param {Object} purchase - The CoinPurchase document.
     */
    async fulfillPurchase(purchase) {
        if (purchase.status === "SUCCESS") return;

        const totalCoins = purchase.coins + purchase.bonusCoins;

        const user = await User.findById(purchase.userId);
        if (!user) {
            console.error(`User ${purchase.userId} not found for purchase ${purchase._id}`);
            return;
        }

        // 1. Mark purchase as SUCCESS
        purchase.status = "SUCCESS";
        await purchase.save();

        // 2. Add coins to User Wallet
        user.wallet.coins += totalCoins;
        user.playerStats.totalCoinsEarned += totalCoins;
        await user.save();

        // 3. Create Wallet Transaction log
        await WalletTransaction.create({
            userId: user._id,
            type: "COIN_PURCHASE",
            amount: totalCoins,
            balanceAfter: user.wallet.coins,
            description: `Coins purchased via Package ID: ${purchase.packageId}`,
        });
    }
}

module.exports = new StripeService();

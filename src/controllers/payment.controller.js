const StripeService = require("../services/stripe.service");
const IapService = require("../services/iap.service");
const CoinPackage = require("../models/CoinPackage");
const stripe = require("stripe")(require("../config/env").STRIPE_SECRET_KEY);
const env = require("../config/env");

class PaymentController {
    /**
     * Creates a payment intent for purchasing a coin package
     */
    async createPayment(req, res) {
        try {
            const { packageId, platform, token } = req.body;
            const user = req.user; // Assuming user is injected by auth middleware

            if (!packageId || !platform) {
                return res.status(400).json({
                    success: false,
                    message: "packageId and platform are required",
                });
            }

            const coinPackage = await CoinPackage.findById(packageId);
            if (!coinPackage) {
                return res.status(404).json({
                    success: false,
                    message: "Coin package not found",
                });
            }

            if (!coinPackage.isActive) {
                return res.status(400).json({
                    success: false,
                    message: "Coin package is no longer active",
                });
            }

            const result = await StripeService.createPaymentIntent(
                coinPackage,
                user,
                platform,
                token
            );

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            console.error("Payment creation error:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to create payment",
            });
        }
    }

    /**
     * Handles Stripe webhooks
     */
    async webhook(req, res) {
        const sig = req.headers["stripe-signature"];

        let event;

        try {
            // req.body must be the raw buffer here
            event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            console.error(`Webhook signature verification failed: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            await StripeService.handleWebhook(event);
            res.json({ received: true });
        } catch (error) {
            console.error("Webhook processing error:", error);
            res.status(500).json({ error: "Failed to process webhook" });
        }
    }

    /**
     * Verify an in-app purchase receipt from Apple/Google and credit coins.
     * JWT-protected (user-facing). The server resolves the coin amount from the
     * product id — the client never sends an amount.
     *
     * Body: { platform, provider, productId, transactionId, receipt }
     */
    async verifyIap(req, res) {
        try {
            const { platform, provider, productId, transactionId, receipt } = req.body;
            const user = req.user;

            if (!platform || !provider || !productId || !transactionId || !receipt) {
                return res.status(400).json({
                    success: false,
                    message: "platform, provider, productId, transactionId and receipt are required",
                });
            }

            const result = await IapService.fulfillIap(user, {
                platform, provider, productId, transactionId, receipt,
            });

            return res.status(200).json({
                success: true,
                message: result.alreadyFulfilled
                    ? "Purchase already fulfilled"
                    : "Coins credited successfully",
                data: result,
            });
        } catch (error) {
            console.error("IAP verify error:", error);
            return res.status(400).json({
                success: false,
                message: error.message || "Failed to verify IAP purchase",
            });
        }
    }
}

module.exports = new PaymentController();

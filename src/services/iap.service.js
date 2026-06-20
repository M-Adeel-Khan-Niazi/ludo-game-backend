const env = require("../config/env");
const CoinPackage = require("../models/CoinPackage");
const CoinPurchase = require("../models/CoinPurchase");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");

/**
 * In-App Purchase service.
 *
 * Mirrors the secure Stripe fulfillment pattern (see stripe.service.js -> fulfillPurchase),
 * with the addition of a receipt-verification step that runs BEFORE any coins are credited.
 *
 * The verifier (`verifyReceiptWithStore`) is currently a STUB that trusts the receipt.
 * It is isolated to a single method so that real Apple/Google verification can be dropped
 * in later without touching the fulfillment logic. See the TODO inside the method.
 */
class IapService {
    /**
     * Verify a receipt with the platform's store server.
     *
     * TODO (verify-iap): Replace this stub with real server-to-server verification.
     *
     *   APPLE  (App Store Server API):
     *     Use the `node-appstore-server-api` library with the following env vars
     *     (already declared in config/env.js):
     *       env.APPLE_ISSUER_ID, env.APPLE_KEY_ID, env.APPLE_PRIVATE_KEY, env.APPLE_BUNDLE_ID
     *     Verify the JWS transaction token returned by StoreKit 2, extract the
     *     transactionId and productId, and confirm the transaction is valid and
     *     not refunded.
     *
     *   GOOGLE (Play Developer API):
     *     Use the `googleapis` library with a service-account JSON
     *     (env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) that has financial permissions on
     *     the Play Console. Call purchases.products.get (or the latest billing
     *     equivalent) with env.ANDROID_PACKAGE_NAME + the productId + the
     *     purchaseToken (passed in as `receipt` from the client).
     *
     * Until the real verifier is implemented this method returns `{ valid: true }`
     * and effectively trusts the client. INSECURE FOR PRODUCTION — complete the
     * implementation and provision credentials before shipping IAP to real users.
     *
     * @param {String} provider        "APPLE" | "GOOGLE"
     * @param {String} receipt         Raw receipt / purchase token / JWS from the client
     * @param {String} productId       Store product id claimed by the client
     * @param {String} transactionId   Store transaction id claimed by the client
     * @returns {Promise<{valid: boolean, reason?: string}>}
     */
    async verifyReceiptWithStore(provider, receipt, productId, transactionId) {
        if (!receipt || !productId || !transactionId) {
            return { valid: false, reason: "Missing receipt fields" };
        }

        // STUB — replace with the real Apple/Google verification described above.
        return { valid: true };
    }

    /**
     * Resolve a server-side CoinPackage from a store product id.
     * The server is authoritative over how many coins a product grants — the
     * client NEVER sends an amount. A single CoinPackage may be sold under
     * different SKUs on Apple vs Google, hence the $or.
     *
     * @param {String} productId
     * @returns {Promise<Object|null>}
     */
    async resolvePackageByProductId(productId) {
        return CoinPackage.findOne({
            $or: [{ appleProductId: productId }, { googleSku: productId }],
            isActive: true,
        });
    }

    /**
     * Verify a receipt and credit coins to the user. Idempotent by transactionId.
     *
     * @param {Object} user                       Authenticated Mongoose User document
     * @param {Object} payload
     * @param {String} payload.platform           "ANDROID" | "IOS"
     * @param {String} payload.provider           "GOOGLE" | "APPLE"
     * @param {String} payload.productId          Store product id
     * @param {String} payload.transactionId      Store transaction id (dedup key)
     * @param {String} payload.receipt            Raw receipt / purchase token / JWS
     * @returns {Promise<Object>}                 { success, coinsGranted, newBalance, alreadyFulfilled? }
     */
    async fulfillIap(user, { platform, provider, productId, transactionId, receipt }) {
        if (!["ANDROID", "IOS"].includes(platform)) {
            throw new Error("Invalid platform specified");
        }
        if (!["GOOGLE", "APPLE"].includes(provider)) {
            throw new Error("Invalid provider specified");
        }

        // 1. Idempotency — if we've already credited this transaction, just return
        const existing = await CoinPurchase.findOne({ transactionId });
        if (existing && existing.status === "SUCCESS") {
            const u = await User.findById(user._id).select("wallet");
            return {
                success: true,
                alreadyFulfilled: true,
                coinsGranted: 0,
                newBalance: u ? u.wallet.coins : 0,
            };
        }

        // 2. Verify the receipt with the store (currently a stub — see TODO above)
        const verification = await this.verifyReceiptWithStore(provider, receipt, productId, transactionId);
        if (!verification.valid) {
            throw new Error(`Receipt verification failed: ${verification.reason || "invalid"}`);
        }

        // 3. Resolve coin amount from the SERVER-SIDE package (never trust client amount)
        const pkg = await this.resolvePackageByProductId(productId);
        if (!pkg) {
            throw new Error(`Unknown product id: ${productId}`);
        }

        const totalCoins = pkg.coins + pkg.bonusCoins;

        // 4. Record the purchase as SUCCESS (mirrors stripe.service.js:120-121)
        await CoinPurchase.create({
            userId: user._id,
            packageId: pkg._id,
            platform,
            coins: pkg.coins,
            bonusCoins: pkg.bonusCoins,
            amount: pkg.pricePKR,
            amountType: "PKR",
            transactionId,
            receipt,
            provider,
            status: "SUCCESS",
        });

        // 5. Credit wallet atomically (mirrors stripe.service.js:124-126, but via $inc)
        const updated = await User.findByIdAndUpdate(
            user._id,
            { $inc: { "wallet.coins": totalCoins, "playerStats.totalCoinsEarned": totalCoins } },
            { new: true }
        );

        // 6. Ledger entry (mirrors stripe.service.js:129-135)
        await WalletTransaction.create({
            userId: user._id,
            type: "COIN_PURCHASE",
            amount: totalCoins,
            balanceAfter: updated.wallet.coins,
            description: `IAP purchase: ${productId}`,
        });

        return {
            success: true,
            coinsGranted: totalCoins,
            newBalance: updated.wallet.coins,
        };
    }
}

module.exports = new IapService();

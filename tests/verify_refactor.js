const mongoose = require("mongoose");
const CoinPackage = require("../src/models/CoinPackage");
const CoinPurchase = require("../src/models/CoinPurchase");
const User = require("../src/models/User");
const WalletService = require("../src/services/wallet.service");
const PackageService = require("../src/services/package.service");
const dotenv = require("dotenv");

dotenv.config();

async function runTests() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);
        console.log("Connected.");

        // 1. Create a Package via Service
        console.log("\n--- Testing Package Creation via Service ---");
        const testPackage = await PackageService.createPackage({
            title: "Refactor Test Pack",
            pricePKR: 500,
            priceUSD: 2,
            isPopular: false,
            coins: 5000,
            bonusCoins: 500,
            isActive: true,
        });
        console.log("Package created:", testPackage.title);

        // 2. Find a test user or create one
        let user = await User.findOne({ role: "user" });
        if (!user) {
            user = await User.create({
                fullName: "Refactor Test User",
                email: "refactortest@example.com",
                role: "user",
                wallet: { coins: 0, lockedCoins: 0 },
                playerId: Date.now() % 1000000,
            });
        }
        const initialBalance = user.wallet.coins;
        console.log("Using user:", user.email, "| Initial Balance:", initialBalance);

        // 3. Buy Package via WalletService
        console.log("\n--- Testing Package Purchase (Refactored) ---");
        const transactionId = "TXN_" + Date.now();
        const result = await WalletService.purchasePackage(
            user._id,
            testPackage._id,
            "WEB",
            "PAYFAST",
            testPackage.pricePKR,
            "PKR",
            transactionId
        );
        console.log("Purchase Success.");
        console.log("New Balance:", result.wallet.coins);

        const expectedBalance = initialBalance + testPackage.coins + testPackage.bonusCoins;
        if (result.wallet.coins === expectedBalance) {
            console.log("PASSED: Balance updated correctly.");
        } else {
            console.log("FAILED: Balance mismatch.");
        }

        // 4. Verify Record Details
        const purchase = await CoinPurchase.findOne({ transactionId });
        if (purchase && purchase.amount === testPackage.pricePKR && purchase.amountType === "PKR") {
            console.log("PASSED: CoinPurchase record fields (amount, amountType, transactionId) verified.");
        } else {
            console.log("FAILED: CoinPurchase record verification failed.");
            console.log("Purchase Record:", purchase);
        }

        // Cleanup
        await CoinPackage.findByIdAndDelete(testPackage._id);
        console.log("Test package deleted.");

    } catch (error) {
        console.error("Test failed:", error);
    } finally {
        await mongoose.connection.close();
        console.log("Disconnected.");
    }
}

runTests();

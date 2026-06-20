/**
 * Seed CoinPackage documents for IAP product IDs.
 *
 * Idempotent: uses findOneAndUpdate with upsert, so re-running updates
 * existing docs instead of creating duplicates.
 *
 * Run: node scripts/seed-iap-packages.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const CoinPackage = require("../src/models/CoinPackage");

const IAP_PACKAGES = [
    { id: "com.ozancube.ludoroyalclub.coins_10_regular",  coins: 10,  pricePKR: 1000,  title: "Coins 10" },
    { id: "com.ozancube.ludoroyalclub.coins_20_regular",  coins: 20,  pricePKR: 2000,  title: "Coins 20" },
    { id: "com.ozancube.ludoroyalclub.coins_50_regular",  coins: 50,  pricePKR: 5000,  title: "Coins 50" },
    { id: "com.ozancube.ludoroyalclub.coins_100_regular", coins: 100, pricePKR: 10000, title: "Coins 100" },
    { id: "com.ozancube.ludoroyalclub.coins_100_sale",    coins: 100, pricePKR: 9000,  title: "Coins 100 (Sale)" },
    { id: "com.ozancube.ludoroyalclub.coins_200_regular", coins: 200, pricePKR: 20000, title: "Coins 200" },
    { id: "com.ozancube.ludoroyalclub.coins_200_sale",    coins: 200, pricePKR: 17000, title: "Coins 200 (Sale)" },
    { id: "com.ozancube.ludoroyalclub.coins_500_regular", coins: 500, pricePKR: 50000, title: "Coins 500" },
    { id: "com.ozancube.ludoroyalclub.coins_500_sale",    coins: 500, pricePKR: 40000, title: "Coins 500 (Sale)" },
];

const run = async () => {
    const timer = setTimeout(() => {
        console.error("❌ Connection timeout after 10s");
        process.exit(1);
    }, 10000);

    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGODB_URI);
        clearTimeout(timer);
        console.log("✅ Connected.\n");

        let created = 0;
        let updated = 0;

        for (const pkg of IAP_PACKAGES) {
            const result = await CoinPackage.findOneAndUpdate(
                { appleProductId: pkg.id },
                {
                    $set: {
                        title: pkg.title,
                        coins: pkg.coins,
                        bonusCoins: 0,
                        pricePKR: pkg.pricePKR,
                        priceUSD: 0,
                        appleProductId: pkg.id,
                        googleSku: pkg.id,
                        isActive: true,
                    },
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            const isNew = result.createdAt && result.createdAt.getTime() === result.updatedAt.getTime();
            if (isNew) created++;
            else updated++;

            console.log(`  ${isNew ? "✅ Created" : "🔄 Updated"}  ${pkg.id}`);
            console.log(`     _id: ${result._id}  coins: ${result.coins}  pricePKR: ${result.pricePKR}`);
        }

        console.log(`\nDone. ${created} created, ${updated} updated (out of ${IAP_PACKAGES.length}).`);
    } catch (err) {
        clearTimeout(timer);
        console.error("❌ Seed failed:", err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected.");
    }
};

run();

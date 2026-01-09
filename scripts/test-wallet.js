const { connectDB } = require("../src/config/db");
const mongoose = require("mongoose");
const WalletService = require("../src/services/WalletService");
const User = require("../src/models/User");
const WalletTransaction = require("../src/models/WalletTransaction");

const runTest = async () => {
    // Timeout for connection
    const timer = setTimeout(() => {
        console.error("❌ Connection Timeout after 5s");
        process.exit(1);
    }, 5000);

    try {
        console.log("Connecting to DB...");
        // Hack: overload mongoose.connect to debug
        const originalConnect = mongoose.connect;
        mongoose.connect = async function (uri, options) {
            console.log("Mongoose connecting to:", uri ? "URI provided" : "No URI");
            return originalConnect.apply(mongoose, arguments);
        };

        if (!process.env.MONGODB_URI) {
            console.log("WARN: MONGODB_URI is undefined in process.env");
        } else {
            console.log("MONGODB_URI is set");
        }

        await connectDB();
        clearTimeout(timer);
        console.log("DB Connected via app config.");
    } catch (e) {
        clearTimeout(timer);
        console.error("DB Connect validation failed", e);
        process.exit(1);
    }

    // Cleanup previous test data
    console.log("Cleaning up old test data...");
    await User.deleteMany({ email: "testwallet@example.com" });
    await WalletTransaction.deleteMany({ description: /test match|Joined game|Won game|Lost game/ });

    // Create a user
    const user = await User.create({
        fullName: "Test Wallet User",
        email: "testwallet@example.com",
        wallet: { coins: 1000, lockedCoins: 0 }
    });
    console.log(`Created user ${user._id} with 1000 coins`);

    // Test 1: Simple Join Game
    console.log("\n--- Test 1: Join Game (50 coins) ---");
    const matchId = new mongoose.Types.ObjectId();
    try {
        const res = await WalletService.joinGame(user._id, 50, matchId);
        console.log("Join Game Result:", res);
        if (res.coins === 950 && res.lockedCoins === 50) console.log("✅ Join Success");
        else console.log("❌ Join Failed Balance Check");
    } catch (e) {
        console.log("❌ Join Error:", e.message);
    }

    // Test 2: Concurrent Joins (Race Condition)
    console.log("\n--- Test 2: Concurrent Joins (10x 10 coins) ---");
    const promises = [];
    for (let i = 0; i < 10; i++) {
        promises.push(WalletService.joinGame(user._id, 10, new mongoose.Types.ObjectId()));
    }

    try {
        await Promise.all(promises);
        const updatedUser = await User.findById(user._id);
        console.log("Concurrent Join Result:", updatedUser.wallet);
        // Initial 1000, -50 (Test 1), -100 (Test 2) = 850
        // Locked: 50 + 100 = 150
        if (updatedUser.wallet.coins === 850 && updatedUser.wallet.lockedCoins === 150) {
            console.log("✅ Concurrent Join Success");
        } else {
            console.log("❌ Concurrent Join Balance Mismatch");
        }
    } catch (e) {
        console.log("❌ Concurrent Join Error:", e.message);
    }

    // Test 3: Insufficient Balance
    console.log("\n--- Test 3: Insufficient Balance ---");
    try {
        // Current 850. Try to join for 1000
        await WalletService.joinGame(user._id, 1000, new mongoose.Types.ObjectId());
        console.log("❌ Insufficient Balance Check Failed (Should have thrown error)");
    } catch (e) {
        console.log("✅ Insufficient Balance Check Passed:", e.message);
    }

    // Test 4: Cancel Game (Refund)
    console.log("\n--- Test 4: Cancel Game (Refund 50) ---");
    try {
        const res = await WalletService.cancelGame(user._id, 50, matchId); // matchId from Test 1
        console.log("Cancel Result:", res);
        // Expected: Coins 850+50=900, Locked 150-50=100
        if (res.coins === 900 && res.lockedCoins === 100) console.log("✅ Cancel Success");
        else console.log("❌ Cancel Balance Check Failed");
    } catch (e) {
        console.log("❌ Cancel Error:", e.message);
    }

    // Test 5: Settle Win
    console.log("\n--- Test 5: Settle Win (Win 20 on a 10 coin game) ---");
    try {
        await WalletService.settleWin(user._id, 10, 20, new mongoose.Types.ObjectId());

        const finalUser = await User.findById(user._id);
        console.log("Settle Win Result:", finalUser.wallet);
        // Expected: Coins 900 + 20 = 920. Locked 100 - 10 = 90.
        if (finalUser.wallet.coins === 920 && finalUser.wallet.lockedCoins === 90) {
            console.log("✅ Settle Win Success");
        } else {
            console.log("❌ Settle Win Balance Check Failed");
        }
    } catch (e) {
        console.log("❌ Settle Win Error:", e.message);
    }

    console.log("\n--- Done ---");
    process.exit(0);
};

runTest();

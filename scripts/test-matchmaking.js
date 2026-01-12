const { connectDB } = require("../src/config/db");
const mongoose = require("mongoose");
const MatchService = require("../src/services/match.service");
const User = require("../src/models/User");
const Match = require("../src/models/Match");

const runTest = async () => {
    // Timeout
    const timer = setTimeout(() => {
        console.error("❌ Timeout");
        process.exit(1);
    }, 10000);

    try {
        await connectDB();

        // Cleanup
        await User.deleteMany({ email: /^testplayer/ });
        await Match.deleteMany({ gameType: "1V1" }); // Be careful not to delete prod data if any

        // Create 2 users
        const user1 = await User.create({ fullName: "P1", email: "testplayer1@example.com", wallet: { coins: 1000, lockedCoins: 0 } });
        const user2 = await User.create({ fullName: "P2", email: "testplayer2@example.com", wallet: { coins: 1000, lockedCoins: 0 } });

        console.log("Created users:", user1._id, user2._id);

        // 1. User 1 creates 1v1 match (50 coins)
        console.log("\n--- Test 1: Create 1v1 Match ---");
        const match = await MatchService.createMatchAndJoin(user1._id, "1V1", 50, false);
        console.log("Match Created:", match.roomCode, match.state);

        const u1 = await User.findById(user1._id);
        if (u1.wallet.coins === 950 && u1.wallet.lockedCoins === 50) console.log("✅ P1 Coins Locked");
        else console.log("❌ P1 Coins Check Failed");

        // 2. User 2 finds and joins public match
        console.log("\n--- Test 2: Find & Join Public Match ---");
        const foundMatch = await MatchService.findAndJoin(user2._id, "1V1", 50);

        console.log("Match Found/Joined:", foundMatch._id);

        // Refresh match to see state
        const updatedMatch = await Match.findById(foundMatch._id);
        console.log("Match State:", updatedMatch.state, "Players:", updatedMatch.players.length);

        if (updatedMatch.state === "RUNNING") console.log("✅ Match Started (Running)");
        else console.log("❌ Match Start Failed");

        const u2 = await User.findById(user2._id);
        if (u2.wallet.coins === 950 && u2.wallet.lockedCoins === 50) console.log("✅ P2 Coins Locked");
        else console.log("❌ P2 Coins Check Failed");

    } catch (e) {
        console.error("Test Failed:", e);
    } finally {
        clearTimeout(timer);
        process.exit(0);
    }
};

runTest();

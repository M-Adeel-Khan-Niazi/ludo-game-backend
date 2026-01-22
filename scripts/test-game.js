const mongoose = require("mongoose");
const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");
const User = require("../src/models/User");
const Match = require("../src/models/Match");
require("dotenv").config();

// Config
const URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 3000;
const SERVER_URL = `http://localhost:${PORT}`;

async function runTest() {
    console.log("Connecting to DB...");
    await mongoose.connect(URI);

    console.log("Creating Test Data...");
    // Create Users
    const u1 = await User.findOneAndUpdate({ email: "test1@ludo.com" }, {
        username: "TestPlayer1", email: "test1@ludo.com", password: "hash"
    }, { upsert: true, new: true });

    const u2 = await User.findOneAndUpdate({ email: "test2@ludo.com" }, {
        username: "TestPlayer2", email: "test2@ludo.com", password: "hash"
    }, { upsert: true, new: true });

    // Create Match MANUALLY (Need to ensure structure matches our latest schema)
    // NOTE: We should test MatchService creation logic too, but for speed, manual creation here.
    // BUT manual creation caused the bug (missing currentTurn).
    // Let's manually set currentTurn correctly here for test.
    const match = await Match.create({
        gameType: "1V1",
        maxPlayers: 2,
        joiningFee: 0,
        roomCode: "TEST01",
        players: [
            { userId: u1._id, color: "red", status: "ACTIVE", tokens: [{ tokenId: "R1", position: -1 }, { tokenId: "R2", position: -1 }] },
            { userId: u2._id, color: "green", status: "ACTIVE", tokens: [{ tokenId: "G1", position: -1 }, { tokenId: "G2", position: -1 }] }
        ],
        currentTurn: {
            userId: u1._id,
            color: "red",
            diceValues: [],
            usedDiceIndices: []
        },
        state: "RUNNING"
    });

    console.log(`Match Created: ${match._id}`);

    // Generate Tokens
    // Server expects _id in payload (based on index.js)
    const t1 = jwt.sign({ sub: u1._id, _id: u1._id }, JWT_SECRET, { expiresIn: "1h" });
    const t2 = jwt.sign({ sub: u2._id, _id: u2._id }, JWT_SECRET, { expiresIn: "1h" });

    // Connect Sockets
    console.log("Connecting Sockets to " + SERVER_URL);
    const s1 = io(SERVER_URL, {
        auth: { token: t1 },
        transports: ['websocket'],
        reconnection: false
    });
    const s2 = io(SERVER_URL, {
        auth: { token: t2 },
        transports: ['websocket'],
        reconnection: false
    });

    // Listeners
    s1.on("connect", () => console.log("Player 1 Connected. ID: " + s1.id));
    s1.on("connect_error", (err) => console.error("P1 Connect Error:", err.message));
    s1.on("disconnect", (reason) => console.log("P1 Disconnected:", reason));
    s1.on("game:state", (data) => console.log("P1 Recv: Game State"));

    s1.on("game:diceRolled", (data) => {
        console.log("P1 Recv: Dice Rolled", data);
        if (data.userId === u1._id.toString()) {
            if (data.hasValidMoves) {
                // Try to use a rolled 6 if available
                const sixIndex = data.diceValues.indexOf(6);
                if (sixIndex !== -1) {
                    console.log(`P1 Found 6 at index ${sixIndex}. Attempting Move (Token R1 -> Start)...`);
                    s1.emit("game:moveToken", { matchId: match._id, tokenId: "R1", diceIndex: sixIndex });
                } else {
                    console.log("P1 rolled " + data.diceValues + ". No 6. Attempting move with index 0 if valid.");
                    s1.emit("game:moveToken", { matchId: match._id, tokenId: "R1", diceIndex: 0 });
                }
            } else {
                console.log("No valid moves possible.");
            }
        }
    });

    s1.on("game:tokenMoved", (data) => console.log("P1 Recv: Token Moved", data));
    s1.on("game:turnChanged", (data) => console.log("P1 Recv: Turn Changed", data));
    s1.on("game:turnContinued", (data) => console.log("P1 Recv: Turn Continued", data));

    s1.on("error", (err) => console.error("P1 Error:", err));

    // Start Flow
    setTimeout(() => {
        console.log("P1 Joining...");
        s1.emit("game:join", { matchId: match._id });

        setTimeout(() => {
            console.log("P1 Rolling Dice...");
            s1.emit("game:rollDice", { matchId: match._id });
        }, 1000);

    }, 1000);

    // Cleanup after test
    setTimeout(async () => {
        console.log("Cleaning up...");
        await Match.deleteOne({ _id: match._id });
        await User.deleteMany({ email: { $in: ["test1@ludo.com", "test2@ludo.com"] } });
        s1.disconnect();
        s2.disconnect();
        await mongoose.disconnect();
        console.log("Done.");
        process.exit(0);
    }, 6000);
}

runTest().catch(console.error);

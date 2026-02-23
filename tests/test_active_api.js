const mongoose = require('mongoose');
const MatchService = require('../src/services/match.service');
const Match = require('../src/models/Match');

// Mock Match model for testing
jest.mock('../src/models/Match');

async function testGetActiveMatch() {
    console.log("Testing MatchService.getActiveMatch...");

    const userId = new mongoose.Types.ObjectId();
    const mockMatch = {
        _id: new mongoose.Types.ObjectId(),
        state: "RUNNING",
        players: [{ userId: userId, color: "red" }]
    };

    // Mock Match.findOne.populate.populate
    const mockPopulate2 = {
        populate: jest.fn().mockResolvedValue(mockMatch)
    };
    const mockPopulate1 = {
        populate: jest.fn().mockReturnValue(mockPopulate2)
    };
    Match.findOne = jest.fn().mockReturnValue(mockPopulate1);

    const result = await MatchService.getActiveMatch(userId);

    console.log("Result Match ID:", result ? result._id : "null");
    console.log("Result State:", result ? result.state : "null");

    if (result && result._id.toString() === mockMatch._id.toString()) {
        console.log("✅ Verification successful: Correct active match found.");
    } else {
        console.log("❌ Verification failed: Match not found or incorrect match returned.");
    }
}

// Since I don't have jest installed or easily runnable in this environment as a standalone, 
// I'll write a simpler mock logic to verify.

async function manualMockTest() {
    console.log("Manual Mock Verification...");

    const userId = new mongoose.Types.ObjectId();
    const mockMatch = {
        _id: new mongoose.Types.ObjectId(),
        state: "RUNNING",
        players: [{ userId: userId, color: "red" }]
    };

    // Manually override Match.findOne to return our mock
    const originalFindOne = Match.findOne;
    Match.findOne = function (query) {
        console.log("Query received:", JSON.stringify(query));
        return {
            populate: function () {
                return {
                    populate: async function () {
                        return mockMatch;
                    }
                }
            }
        };
    };

    try {
        const result = await MatchService.getActiveMatch(userId);
        console.log("Result ID:", result._id);
        if (result._id === mockMatch._id) {
            console.log("✅ SUCCESS");
        } else {
            console.log("❌ FAILURE");
        }
    } finally {
        Match.findOne = originalFindOne;
    }
}

manualMockTest();

const mongoose = require("mongoose");
const { MONGODB_URI } = require("./env");
const logger = require("./logger");

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info("✅ MongoDB connected");

    // Ensure there's always a tournament open for registration
    const TournamentService = require("../services/tournament.service");
    await TournamentService.ensureActiveTournament();
  } catch (error) {
    logger.error("❌ DB Connection Failed: " + error.message);
    process.exit(1);
  }
};

module.exports = { connectDB };

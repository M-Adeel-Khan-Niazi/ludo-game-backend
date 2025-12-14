const mongoose = require("mongoose");
const { MONGODB_URI } = require("./env");
const logger = require("./logger");

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    logger.info("✅ MongoDB connected");
  } catch (error) {
    logger.error("❌ DB Connection Failed: " + error.message);
    process.exit(1);
  }
};

module.exports = { connectDB };

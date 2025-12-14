const morgan = require("morgan");
const logger = require("../config/logger");
const { NODE_ENV } = require("../config/env");

// Morgan stream writes to Winston
const stream = {
  write: (message) => logger.http(message.trim()),
};

// Skip logging during tests
const skip = () => NODE_ENV === "test";

// Use morgan format with Winston integration
const requestLogger = morgan(
  ":method :url :status - :response-time ms",
  { stream, skip }
);

module.exports = requestLogger;

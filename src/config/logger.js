const winston = require("winston");
const { NODE_ENV } = require("./env");
require("winston-daily-rotate-file");

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for console
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
  })
);

// Custom format for files (no colors)
const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

const transports = [
  // 🌈 Colorized console logs
  new winston.transports.Console({
    format: consoleFormat,
  }),

  // 📜 Daily rotating app logs
  new winston.transports.DailyRotateFile({
    filename: "logs/app-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    maxFiles: "14d",
    zippedArchive: true,
    format: fileFormat,
  }),

  // ⚠️ Separate error logs
  new winston.transports.DailyRotateFile({
    filename: "logs/error-%DATE%.log",
    level: "error",
    datePattern: "YYYY-MM-DD",
    maxFiles: "30d",
    zippedArchive: true,
    format: fileFormat,
  }),
];

const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "info" : "debug",
  transports,
});

module.exports = logger;

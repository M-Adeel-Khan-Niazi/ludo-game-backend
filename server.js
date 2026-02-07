const fs = require("fs");
const { NODE_ENV, APP_NAME, PORT } = require("./src/config/env");
const { connectDB } = require("./src/config/db");
const initSocket = require("./src/sockets/index");
const app = require("./src/app");
const logger = require("./src/config/logger");

const server = require("http").createServer(app);

const io = initSocket(server);
global.io = io;

// Start Cron Jobs
require("./src/cron/game.cron");

connectDB();

server.listen(PORT, () => {
  logger.info(`${APP_NAME} is running on port ${PORT}`);
});

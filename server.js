const fs = require("fs");
const { NODE_ENV, APP_NAME, PORT } = require("./src/config/env");
const { connectDB } = require("./src/config/db");
const initSocket = require("./src/sockets/index");
const app = require("./src/app");
const logger = require("./src/config/logger");

const server = require("http").createServer(app);

initSocket(server);

connectDB();

server.listen(PORT, () => {
  logger.info(`${APP_NAME} is running on port ${PORT}`);
});

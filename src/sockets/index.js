const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../config/env");
const logger = require("../config/logger");

module.exports = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      transports: ["websocket", "polling"],
    },
  });

  // Socket authentication middleware
  io.use(async (socket, next) => {
    try {
      // Accept token in either: socket.handshake.auth.token OR Authorization header
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.headers &&
          socket.handshake.headers.authorization &&
          socket.handshake.headers.authorization.split(" ")[1]);

      if (!token)
        return next(new Error("Authentication error: token required"));

      const payload = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(payload.sub).select("-password");
      if (!user) return next(new Error("Authentication error: user not found"));
      socket.user = user; // attach user to socket
      next();
    } catch (err) {
      logger.error("Socket auth error:", err.message);
      next(new Error("Authentication error"));
    }
  });

  // connection
  io.on("connection", (socket) => {
    logger.log(`Socket connected: ${socket.id} userId: ${socket.user._id}`);

    // Example: join a personal room for direct messages
    socket.join(`user:${socket.user._id}`);

    // register handlers

    socket.on("disconnect", (reason) => {
      logger.log(`Socket disconnected: ${socket.id} reason: ${reason}`);
    });
  });

  return io;
};

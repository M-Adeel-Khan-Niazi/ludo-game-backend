const logger = require("../config/logger");

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
};

module.exports = { errorHandler };

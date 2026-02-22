const passport = require("../config/pasport");
const { handlers } = require("../utils/response-handlers");

const authenticateJwt = (req, res, next) => {
  passport.authenticate("jwt", { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user)
      return handlers.response.unauthorized({ res, message: "Unauthorized" });
    req.user = user;
    next();
  })(req, res, next);
};

/**
 * Middleware to restrict access based on roles.
 * @param  {...String} roles
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return handlers.response.forbidden({
        res,
        message: "You do not have permission to perform this action",
      });
    }
    next();
  };
};

module.exports = { authenticateJwt, restrictTo };

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

module.exports = { authenticateJwt };

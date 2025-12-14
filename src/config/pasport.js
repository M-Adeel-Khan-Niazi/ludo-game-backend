const { Strategy: JwtStrategy, ExtractJwt } = require("passport-jwt");
const passport = require("passport");
const User = require("../models/User");
const { JWT_SECRET } = require("./env");

const opts = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: JWT_SECRET,
};

passport.use(
  new JwtStrategy(opts, async (payload, done) => {
    try {
      const user = await User.findById(payload._id).select("-password");
      if (!user) return done(null, false);
      if (user.isDeleted) return done(null, false);
      return done(null, user);
    } catch (err) {
      return done(err, false);
    }
  })
);

module.exports = passport;

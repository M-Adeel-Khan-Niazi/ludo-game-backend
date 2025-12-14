const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");

const emailValidator = (email) => {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
};

const generateOTP = () => {
  const otp = crypto.randomInt(1000, 9999);
  return otp;
};

function generateOTPExpiry(minutes = 1) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

const generateToken = (payload, options = {}) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: "1d",
    ...options,
  });
};

module.exports = {
  emailValidator,
  generateOTP,
  generateOTPExpiry,
  generateToken,
};

const { handlers } = require("../utils/response-handlers");
const {
  emailValidator,
  generateOTPExpiry,
  generateToken,
  generateOTP,
} = require("../utils/helpers");
const sendMail = require("../config/nodemailer");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/User");
const logger = require("../config/logger");
const { format } = require("date-fns");
const twilio = require("twilio");
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SERVICE_ID } = require("../config/env");

class Service {
  constructor() {
    this.user = User;
    this.twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }

  // Signup for User
  async signUpUser(req, res) {
    try {
      const {
        email,
        deviceToken,
        password,
        fullName,
        userName,
        phoneNumber,
        dob,
        avatarId,
      } = req.body;

      // Handle file upload for avatar
      const avatar = avatarId;

      // At least one of email or phoneNumber is required
      if (!email && !phoneNumber) {
        return handlers.response.failed({
          res,
          message: "Email or phone number is required...",
        });
      }

      // Validate email if provided
      if (email && !emailValidator(email)) {
        return handlers.response.failed({ res, message: "Invalid email..." });
      }

      // Check if user already exists with email or phone
      const query = { role: "user" };
      if (userName) query.userName = userName;
      if (email && phoneNumber) {
        query.$or = [{ email }, { phoneNumber }];
      } else if (email) {
        query.email = email;
      } else if (phoneNumber) {
        query.phoneNumber = phoneNumber;
      }

      const existingUser = await this.user.findOne(query);
      if (existingUser && existingUser.isVerified) {
        return handlers.response.failed({
          res,
          message:
            "User with this email or phone number or user name already exists...",
        });
      }

      const otpExpiry = generateOTPExpiry(10);
      const otp = 1234;
      // const otp = generateOTP();

      let user;
      if (existingUser && !existingUser.isVerified) {
        existingUser.otp = otp;
        existingUser.otpExpiry = otpExpiry;
        existingUser.deviceToken = deviceToken;
        if (email) existingUser.email = email;
        if (phoneNumber) existingUser.phoneNumber = phoneNumber;
        if (fullName) existingUser.fullName = fullName;
        if (userName) existingUser.userName = userName;
        if (password) existingUser.password = password;
        if (dob) existingUser.dob = dob;
        if (avatar) existingUser.avatar = avatar;
        user = await existingUser.save();
      } else {
        user = await this.user.create({
          email: email || null,
          phoneNumber: phoneNumber || null,
          role: "user",
          deviceToken,
          authProvider: phoneNumber ? "phone" : "email",
          otp: phoneNumber ? otp : null,
          otpExpiry: phoneNumber ? otpExpiry : null,
          dob: dob || null,
          fullName: fullName || null,
          userName: userName || null,
          password: password || null,
          avatar: avatar || null,
        });
      }

      // Send OTP via email if email is provided
      if (email) {
        await sendMail(
          user.email,
          "Email Verification OTP",
          `Your email verification OTP is: ${otp}\n\nThis OTP will expire in ${format(
            otpExpiry,
            "dd/MM/yyyy hh:mm a"
          )}.`
        );
      } else if (phoneNumber) {
        await this.twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_ID)
          .verifications.create({
            to: phoneNumber,
            channel: "sms",
          }).catch((error) => {
            logger.error({ message: error.message });
            return handlers.response.error({ res, message: error.message });
          });
      }

      return handlers.response.success({
        res,
        message: `User registered successfully. OTP sent to ${email ? "email" : "phone"
          }.`,
        data: { userId: user._id, phoneNumber: user.phoneNumber },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async phoneSignIn(req, res) {
    try {
      const { phoneNumber, deviceToken, role } = req.body;

      if (!phoneNumber || !deviceToken || !role) {
        return handlers.response.failed({
          res,
          message: "Phone number, device token and role are required...",
        });
      }

      if (role !== "user") {
        return handlers.response.failed({ res, message: "Invalid role..." });
      }

      const user = await this.user.findOne({ phoneNumber, role });
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "Account not found. Please sign up first.",
        });
      }

      if (!user.isActive) {
        return handlers.response.unavailable({
          res,
          message: "Account is not active. Please contact support.",
        });
      }
      if (!user.isVerified) {
        return handlers.response.failed({
          res,
          message: "Account is not verified. Please verify your account.",
          error: { userId: user._id, isVerified: false},
        });
      }

      await this.twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_ID)
        .verifications.create({
          to: phoneNumber,
          channel: "sms",
        }).catch((error) => {
          logger.error({ message: error.message });
          return handlers.response.error({ res, message: error.message });
        });

      return handlers.response.success({
        res,
        message: "OTP sent successfully...",
        data: { phoneNumber: user.phoneNumber },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async signIn(req, res) {
    try {
      const { email, phoneNumber, deviceToken, password, role } = req.body;

      // At least one identifier (email or phone) is required
      if (!email && !phoneNumber) {
        return handlers.response.failed({
          res,
          message: "Email or phone number is required...",
        });
      }

      if (!deviceToken || !password) {
        return handlers.response.failed({
          res,
          message: "Device token and password are required...",
        });
      }

      if (role !== "user") {
        return handlers.response.failed({ res, message: "Invalid role..." });
      }

      // Validate email if provided
      if (email && !emailValidator(email)) {
        return handlers.response.failed({ res, message: "Invalid email..." });
      }

      // Find user by email or phone number
      const query = { role };
      if (email) {
        query.email = email;
      } else if (phoneNumber) {
        query.phoneNumber = phoneNumber;
      }

      const user = await this.user.findOne(query);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "Account not found. Please sign up first.",
        });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return handlers.response.failed({
          res,
          message: "Incorrect password.",
        });
      }

      if (!user.isActive) {
        return handlers.response.unavailable({
          res,
          message: "Account is deactivated. Please contact support.",
        });
      }

      if (user.isDeleted) {
        return handlers.response.failed({
          res,
          message: "Login failed. This account is no longer active.",
        });
      }

      if (!user.isVerified) {
        return handlers.response.failed({
          res,
          message: "Account not verified. Please verify your account first.",
          error: { userId: user.id, isVerified: false }
        });
      }
      const payload = { _id: user._id };
      const authToken = generateToken(payload);

      return handlers.response.success({
        res,
        message: "Login successful",
        data: { user, token: authToken },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async verifyOTP(req, res) {
    try {
      const { userId, otp, type } = req.body;

      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return handlers.response.failed({ res, message: "Invalid User ID..." });
      }

      if (!otp) {
        return handlers.response.failed({ res, message: "OTP is required..." });
      }

      const user = await this.user.findById(userId);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      if (!user.otp || !user.otpExpiry) {
        return handlers.response.unavailable({
          res,
          message: "OTP not found or expired. Please request a new one...",
        });
      }

      const currentTime = new Date();
      if (user.otpExpiry.getTime() <= currentTime.getTime()) {
        user.otp = null;
        user.otpExpiry = null;
        await user.save();

        return handlers.response.failed({ res, message: "OTP has expired..." });
      }

      if (user.otp !== Number(otp)) {
        return handlers.response.failed({ res, message: "Invalid OTP..." });
      }

      const payload = { _id: user._id };
      const authToken = generateToken(payload);
      user.otp = null;
      user.otpExpiry = null;
      user.isVerified = true;
      user.isDeleted = false;
      await user.save();

      if (type && type === "forgot") {
        const resetToken = generateToken({ _id: user._id }, {}, "15m");
        const resetExpiry = new Date(Date.now() + 15 * 60 * 1000);
        user.resetTokenExpiry = resetExpiry;
        user.resetToken = resetToken;
        await user.save();

        return handlers.response.success({
          res,
          message: "OTP Verification Successful",
          data: { user, resetToken },
        });
      }

      return handlers.response.success({
        res,
        message: "OTP Verification Successful",
        data: { user, token: authToken },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async verifyPhoneOTP(req, res) {
    try {
      const { phoneNumber, otp } = req.body;

      if (!phoneNumber || !otp) {
        return handlers.response.failed({ res, message: "Phone number and OTP are required..." });
      }

      const user = await this.user.findOne({ phoneNumber });
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      await this.twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_ID)
        .verificationChecks.create({
          to: phoneNumber,
          code: otp.toString(),
        }).catch((error) => {
          logger.error({ message: error.message });
          return handlers.response.error({ res, message: error.message });
        });

      const payload = { _id: user._id };
      const authToken = generateToken(payload);
      user.otp = null;
      user.otpExpiry = null;
      user.isVerified = true;
      user.isDeleted = false;
      await user.save();

      return handlers.response.success({
        res,
        message: "OTP Verification Successful",
        data: { user, token: authToken },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async resendOTP(req, res) {
    try {
      const { userId } = req.body;

      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return handlers.response.failed({ res, message: "Invalid User ID..." });
      }

      const user = await this.user.findById(userId);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      const otp = 1234;
      // const otp = generateOTP();
      user.otp = otp;
      user.otpExpiry = generateOTPExpiry(10);
      await user.save();

      // Send OTP via email if email exists
      if (user.email) {
        await sendMail(
          user.email,
          "Email Verification OTP",
          `Your email verification OTP is: ${otp}\n\nThis OTP will expire in 10 minutes.`
        );
      } else if (user.phoneNumber) {
        await this.twilioClient.verify.v2.services(TWILIO_VERIFY_SERVICE_ID)
          .verifications.create({
            to: user.phoneNumber,
            channel: "sms",
          }).catch((error) => {
            logger.error({ message: error.message });
            return handlers.response.error({ res, message: error.message });
          });
      }

      return handlers.response.success({
        res,
        message: `OTP resent successfully to ${user.email ? "email" : "phone"}`,
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async socialLogin(req, res) {
    try {
      const {
        role,
        authProvider,
        phoneNumber,
        email,
        socialToken,
        deviceToken,
      } = req.body;

      if (!role || !authProvider || !deviceToken || !socialToken) {
        return handlers.response.failed({
          res,
          message:
            "Role, auth provider, device token, and social token are required...",
        });
      }

      if (role !== "user") {
        return handlers.response.failed({ res, message: "Invalid role..." });
      }

      if (!["phone", "google", "apple"].includes(authProvider)) {
        return handlers.response.failed({
          res,
          message: "Invalid Auth Provider...",
        });
      }

      let user;

      if (authProvider === "phone") {
        if (!phoneNumber) {
          return handlers.response.failed({
            res,
            message: "Phone number is required...",
          });
        }

        user = await this.user.findOne({
          phoneNumber,
          role,
        });

        if (user && !user.isActive) {
          return handlers.response.unavailable({
            res,
            message: "Account is deactivated. Please contact support.",
          });
        }

        if (!user) {
          user = await this.user.create({
            role,
            phoneNumber,
            authProvider,
            deviceToken,
            socialToken,
            isVerified: true,
          });
        }

        const authToken = generateToken({ _id: user._id });
        user.deviceToken = deviceToken;
        user.socialToken = socialToken;
        await user.save();

        return handlers.response.success({
          res,
          message: user.isNew
            ? "User registered successfully"
            : "Login successful",
          data: { user, token: authToken },
        });
      } else if (authProvider === "google" || authProvider === "apple") {
        if (!email) {
          return handlers.response.failed({
            res,
            message: "Email is required for social login...",
          });
        }

        user = await this.user.findOne({ email, role });

        if (!user) {
          user = await this.user.create({
            role,
            email,
            authProvider,
            deviceToken,
            socialToken,
            isVerified: true,
          });
        } else if (user.authProvider !== authProvider) {
          return handlers.response.failed({
            res,
            message:
              "This email is already registered with . Please use that method to login.",
          });
        }

        const authToken = generateToken({ _id: user._id });
        user.deviceToken = deviceToken;
        user.socialToken = socialToken;
        await user.save();

        return handlers.response.success({
          res,
          message: user.isNew
            ? "User registered successfully"
            : "Login successful",
          data: { user, token: authToken },
        });
      } else {
        return handlers.response.failed({
          res,
          message: "Something went wrong",
        });
      }
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async signOut(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }

      const user = await this.user.findById(req.user._id);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      user.deviceToken = null;
      await user.save();

      return handlers.response.success({
        res,
        message: "User signed out successfully",
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async setLanguage(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }

      const { interfaceLanguage } = req.body;

      if (!interfaceLanguage) {
        return handlers.response.failed({
          res,
          message: "Interface language is required!",
        });
      }

      const user = await this.user.findById(req.user._id);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      user.interfaceLanguage = interfaceLanguage;
      await user.save();

      return handlers.response.success({
        res,
        message: "Language preference updated successfully",
        data: { user },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async updateProfile(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }
      const updates = req.body;

      // Handle avatar upload
      if (req.file) updates.avatar = req.file.location;

      if (updates.userName) {
        const user = await this.user.findOne({ userName: updates.userName });
        if (user && user._id.toString() !== req.user._id.toString()) {
          return handlers.response.failed({
            res,
            message: "Username already exists...",
          });
        }
      }

      const user = await this.user.findById(req.user._id);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      Object.assign(user, updates);
      await user.save();

      return handlers.response.success({
        res,
        message: "Profile updated successfully",
        data: { user },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async forgotPassword(req, res) {
    try {
      const { email, role } = req.body;

      if (!email || !emailValidator(email)) {
        return handlers.response.failed({ res, message: "Invalid email..." });
      }
      if (!role) {
        return handlers.response.failed({
          res,
          message: "Role is required...",
        });
      }

      if (!["user", "vendor"].includes(role)) {
        return handlers.response.failed({ res, message: "Invalid role..." });
      }

      const user = await this.user.findOne({ email, role });
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      // const otp = generateOTP();
      const otp = 1234;
      user.otp = otp;
      user.otpExpiry = generateOTPExpiry(10);
      await user.save();

      // Send OTP via email
      await sendMail(
        user.email,
        "Password Reset OTP",
        `Your password reset OTP is: ${otp}\n\nThis OTP will expire in 10 minutes.`
      );

      return handlers.response.success({
        res,
        message:
          "If this email exists, we’ve sent an OTP to reset your password.",
        data: { userId: user._id },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async resetPassword(req, res) {
    try {
      const { newPassword, resetToken, userId } = req.body;
      if (!newPassword || !resetToken) {
        return handlers.response.failed({
          res,
          message: "New password and reset token are required",
        });
      }

      const user = await this.user.findById(userId);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }
      const currentTime = new Date();
      if (
        !user.resetToken ||
        user.resetToken !== resetToken ||
        user.resetTokenExpiry.getTime() <= currentTime.getTime()
      ) {
        return handlers.response.failed({
          res,
          message: "Invalid or expired reset token",
        });
      }

      user.password = newPassword;
      user.resetToken = null;
      user.resetTokenExpiry = null;
      await user.save();

      return handlers.response.success({
        res,
        message: "Password reset successfully",
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async deleteAccount(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }

      await this.user.findByIdAndUpdate(req.user._id, { isDeleted: true });

      return handlers.response.success({
        res,
        message: "User account deleted successfully",
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async updatePassword(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return handlers.response.failed({
          res,
          message: "Current and new passwords are required",
        });
      }

      const user = await this.user.findById(req.user._id);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return handlers.response.failed({
          res,
          message: "Current password is incorrect",
        });
      }

      user.password = newPassword;
      await user.save();

      return handlers.response.success({
        res,
        message: "Password updated successfully",
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async getProfile(req, res) {
    try {
      if (!req.user || !req.user._id) {
        return handlers.response.unauthorized({
          res,
          message: "User not logged in...",
        });
      }

      const user = await this.user.findById(req.user._id);
      if (!user) {
        return handlers.response.unavailable({
          res,
          message: "User not found...",
        });
      }

      return handlers.response.success({
        res,
        message: "User profile retrieved successfully",
        data: { user },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }

  async checkAvailability(req, res) {
    try {
      const { email, phoneNumber, userName } = req.body;

      // At least one identifier is required
      if (!email && !phoneNumber && !userName) {
        return handlers.response.failed({
          res,
          message:
            "Email or phone number or user name is required to check availability...",
        });
      }

      // Validate email format if provided
      if (email && !emailValidator(email)) {
        return handlers.response.failed({
          res,
          message: "Invalid email format...",
        });
      }

      const result = {
        email: null,
        phoneNumber: null,
        userName: null,
      };

      // Check email availability
      if (email) {
        const query = { email };

        const emailExists = await this.user
          .findOne(query)
          .select("_id email role isVerified");

        if (emailExists) {
          result.email = {
            available: false,
            exists: true,
            message: "Email already exists",
            verified: emailExists.isVerified,
            role: emailExists.role,
          };
        } else {
          result.email = {
            available: true,
            exists: false,
            message: "Email is available",
          };
        }
      }

      // Check phone number availability
      if (phoneNumber) {
        const query = { phoneNumber };

        const phoneExists = await this.user
          .findOne(query)
          .select("_id phoneNumber role isVerified");

        if (phoneExists) {
          result.phoneNumber = {
            available: false,
            exists: true,
            message: "Phone number already exists",
            verified: phoneExists.isVerified,
            role: phoneExists.role,
          };
        } else {
          result.phoneNumber = {
            available: true,
            exists: false,
            message: "Phone number is available",
          };
        }
      }
      // Check user name availability
      if (userName) {
        const query = { userName };

        const phoneExists = await this.user
          .findOne(query)
          .select("_id userName role isVerified");

        if (phoneExists) {
          result.userName = {
            available: false,
            exists: true,
            message: "User name already exists",
            verified: phoneExists.isVerified,
            role: phoneExists.role,
          };
        } else {
          result.userName = {
            available: true,
            exists: false,
            message: "User name is available",
          };
        }
      }

      // Determine overall availability
      const isAvailable =
        (!email || result.email.available) &&
        (!phoneNumber || result.phoneNumber.available) &&
        (!userName || result.userName.available);

      return handlers.response.success({
        res,
        message: isAvailable
          ? "Credentials are available"
          : "One or more credentials already exist",
        data: {
          available: isAvailable,
          ...result,
        },
      });
    } catch (error) {
      logger.error({ message: error.message });
      return handlers.response.error({ res, message: error.message });
    }
  }
}

module.exports = new Service();

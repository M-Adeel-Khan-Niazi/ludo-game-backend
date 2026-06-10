const { Schema, model } = require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new Schema(
  {
    fullName: { type: String, trim: true, default: null },
    timezone: { type: String, trim: true, default: null },
    userName: { type: String, trim: true, default: null },
    playerId: { type: Number, unique: true, default: null },
    dob: { type: String, trim: true, default: null },
    location: {
      name: { type: String, default: null },
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0], index: "2dsphere" },
    },
    wallet: {
      coins: { type: Number, default: 50 },
      lockedCoins: { type: Number, default: 0 } // during matches
    },
    playerStats: {
      gamesPlayed: { type: Number, default: 0 },
      games4PWon: { type: Number, default: 0 },
      games2PWon: { type: Number, default: 0 },
      tournamentWon: { type: Number, default: 0 },
      totalCoinsEarned: { type: Number, default: 0 },
      totalCoinsSpent: { type: Number, default: 0 },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      index: true,
    },
    phoneNumber: { type: String, trim: true, default: null },
    socialToken: { type: String, trim: true, default: null },
    deviceToken: { type: String, trim: true, default: null },
    password: { type: String, trim: true, default: null },
    otp: { type: Number, default: null },
    otpExpiry: { type: Date, default: null },
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
    authProvider: {
      type: String,
      enum: ["google", "apple", "phone", "email"],
      trim: true,
      default: "email",
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    isBot: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    isNotificationEnabled: { type: Boolean, default: false },
    isProfileCompleted: { type: Boolean, default: false },
    avatar: { type: String, trim: true, default: null },
    friends: [{ type: Schema.Types.ObjectId, ref: "User" }],
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.index(
  { userName: 1, isBot: 1 },
  {
    unique: true,
    partialFilterExpression: { isBot: true, userName: { $type: "string" } },
  }
);

userSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.password;
    delete ret.socialToken;
    delete ret.deviceToken;
    delete ret.otp;
    delete ret.otpExpiry;
    delete ret.__v;
    return ret;
  },
});

const User = model("User", userSchema);

module.exports = User;

const { Schema, model } = require("mongoose");

const coinPurchaseSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    packageId: { type: Schema.Types.ObjectId, ref: "CoinPackage", default: null },

    platform: { type: String, enum: ["ANDROID", "IOS", "WEB"] },

    coins: { type: Number, default: 0 },
    bonusCoins: { type: Number, default: 0 },

    amount: { type: Number, default: 0 },
    amountType: { type: String, enum: ["PKR", "USD"] },
    transactionId: { type: String, default: "" },
    gatewayFee: { type: Number, default: 0 },

    provider: {
      type: String,
      enum: ["GOOGLE", "APPLE", "JAZZCASH", "EASYPAISA", "PAYFAST"]
    },
    status: { type: String, enum: ["PENDING", "SUCCESS", "FAILED"] }
  },
  { timestamps: true }
);

const CoinPurchase = model("CoinPurchase", coinPurchaseSchema);

module.exports = CoinPurchase;

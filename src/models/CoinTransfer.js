const { Schema, model } = require("mongoose");

const coinTransferSchema = new Schema(
  {
    senderId: { type: Schema.Types.ObjectId, ref: "User" },
    receiverId: { type: Schema.Types.ObjectId, ref: "User" },

    amount: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },

    status: { type: String, enum: ["SUCCESS", "FAILED"] }
  },
  { timestamps: true }
);

const CoinTransfer = model("CoinTransfer", coinTransferSchema);

module.exports = CoinTransfer;

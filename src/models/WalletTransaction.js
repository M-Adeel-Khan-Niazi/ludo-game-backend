const { Schema, model } = require("mongoose");

const walletTransactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },

    type: {
      type: String,
      enum: [
        "GAME_JOIN",
        "GAME_WIN",
        "GAME_LOSS",
        "GAME_REFUND",
        "TOURNAMENT_WIN",
        "COIN_PURCHASE",
        "TRANSFER_IN",
        "TRANSFER_OUT",
        "WITHDRAWAL",
        "GIFT_SENT",
        "GIFT_RECEIVED"
      ]
    },

    amount: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },

    matchId: { type: Schema.Types.ObjectId, ref: "Match" },
    tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament" },
    description: { type: String, default: null }
  },
  { timestamps: true }
);

const WalletTransaction = model("WalletTransaction", walletTransactionSchema);

module.exports = WalletTransaction;

const { Schema, model } = require("mongoose");

const tournamentSchema = new Schema(
  {
    category: {
      type: String,
      enum: ["BRONZE", "SILVER", "GOLD", "PLATINUM"]
    },

    entryFee: { type: Number, default: 0 },
    multiplier: { type: Number, default: 1 }, // T = 5
    playersRequired: { type: Number, default: 16 },

    players: [{ type: Schema.Types.ObjectId, ref: "User" }],
    rounds: [{
      gameIds: [{ type: Schema.Types.ObjectId, ref: "Game" }]
    }],

    winner: { type: Schema.Types.ObjectId, ref: "User" },
    winningAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["WAITING", "RUNNING", "COMPLETED"]
    }

  },
  { timestamps: true }
);

const Tournament = model("Tournament", tournamentSchema);

module.exports = Tournament;

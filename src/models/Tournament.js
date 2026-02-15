const { Schema, model } = require("mongoose");

const TournamentSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    entryFee: { type: Number, required: true },
    prizePool: { type: Number, default: 0 },
    winningMultiplier: { type: Number, default: 0.85 },
    maxPlayers: { type: Number, default: 16 },

    status: {
      type: String,
      enum: ["REGISTRATION", "SEMI_FINAL", "FINAL", "COMPLETED", "CANCELLED"],
      default: "REGISTRATION"
    },

    players: [{
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      registeredAt: { type: Date, default: Date.now }
    }],

    rounds: [{
      roundNumber: { type: Number }, // 1 = semi-final, 2 = final
      matches: [{
        matchId: { type: Schema.Types.ObjectId, ref: "Match" },
        tableNumber: { type: Number },
        winner: { type: Schema.Types.ObjectId, ref: "User", default: null }
      }]
    }],

    winner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

const Tournament = model("Tournament", TournamentSchema);

module.exports = Tournament;

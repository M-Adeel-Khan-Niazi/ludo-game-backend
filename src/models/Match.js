const { Schema, model } = require("mongoose");

const MatchSchema = new Schema(
  {
    gameType: {
      type: String,
      enum: ["1V1", "2V2", "4P", "PRIVATE", "TOURNAMENT"]
    },
    roomCode: { type: String, unique: true },
    maxPlayers: { type: Number, required: true },

    joiningFee: { type: Number, default: 0 },
    winningMultiplier: { type: Number, default: 1 }, // W

    players: [{
      color: { type: String, enum: ["red", "green", "yellow", "blue"] },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      team: { type: Number, default: null }, // 1 or 2 (for 2v2)
      status: { type: String, enum: ["ACTIVE", "LEFT", "DISCONNECTED"] },
      tokens: [
        {
          tokenId: { type: String, default: null },      // "R1", "R2", "R3", "R4"
          position: { type: Number, default: -1 },       // -1 = home, 0–51 board, 52–57 home path
          isFinished: { type: Boolean, default: false }
        }
      ],

    }],

    currentTurn: {
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      color: { type: String, enum: ["red", "green", "yellow", "blue"] },
      diceValues: [{ type: Number }], // Array of rolled values e.g. [3, 5]
      usedDiceIndices: [{ type: Number }], // Array of indices of used dice e.g. [0]
      rollCount: { type: Number, default: 0 } // Track rolls if implementing 3x 6s rule
    },

    winner: { type: Schema.Types.ObjectId, ref: "User" },
    winningAmount: { type: Number, default: 0 },

    adminProfit: { type: Number, default: 0 },
    state: {
      type: String,
      enum: ["WAITING", "RUNNING", "COMPLETED", "CANCELLED"]
    },
    isPrivate: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const Match = model("Match", MatchSchema);

module.exports = Match;

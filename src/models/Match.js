const { Schema, model } = require("mongoose");

const MatchSchema = new Schema(
  {
    gameType: {
      type: String,
      enum: ["1V1", "2V2", "4P", "PRIVATE", "TOURNAMENT"]
    },
    difficultyTier: {
      type: String,
      enum: ["BRONZE", "SILVER", "GOLD", "PLATINUM"],
      default: "BRONZE"
    },
    roomCode: { type: String, unique: true },
    maxPlayers: { type: Number, required: true },

    joiningFee: { type: Number, default: 0 },
    winningMultiplier: { type: Number, default: 1 },

    isVsBot: { type: Boolean, default: false },
    players: [{
      color: { type: String, enum: ["red", "green", "yellow", "blue"] },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      isBot: { type: Boolean, default: false },
      team: { type: Number, default: null }, // 1 or 2 (for 2v2)
      status: { type: String, enum: ["ACTIVE", "LEFT", "DISCONNECTED", "DISQUALIFIED", "WON"] },
      isHost: { type: Boolean, default: false }, // Rule-14
      hasCaptured: { type: Boolean, default: false }, // Rule-5: Need capture to enter home
      disconnectedAt: { type: Date, default: null }, // Rule-9: 2m timeout
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
      rollCount: { type: Number, default: 0 }, // Track rolls if implementing 3x 6s rule
      pendingBonus: { type: Number, default: 0 }, // Track the number of pending bonus turns (capture/finish) triggered
      rollingPhase: { type: Boolean, default: true }, // true = must roll, false = must move
      turnDeadline: { type: Date }, // Rule-11 & 17: Turn Timer persistence
      
      // [FIX] Added this field so Mongoose saves the turn number!
      turn: { type: Number, default: 1 } 
    },

    winner: { type: Schema.Types.ObjectId, ref: "User" },
    winningAmount: { type: Number, default: 0 },

    adminProfit: { type: Number, default: 0 },
    lastActionSerial: { type: Number, default: 0 }, // Rule-16: Optimistic locking / Order check
    state: {
      type: String,
      enum: ["WAITING", "RUNNING", "COMPLETED", "CANCELLED"]
    },
    isPrivate: { type: Boolean, default: false },
    tournamentId: { type: Schema.Types.ObjectId, ref: "Tournament", default: null }
  },
  { timestamps: true }
);

const Match = model("Match", MatchSchema);

module.exports = Match;
const { Schema, model } = require("mongoose");

const matchLogsSchema = new Schema(
  {
    matchId: { type: Schema.Types.ObjectId, ref: "Match" },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    eventType: {
      type: String,
      enum: [
        "JOIN",
        "DICE_ROLL",
        "MOVE",
        "KILL",
        "WIN",
        "DISCONNECT",
        "RECONNECT"
      ]
    },
    payload: Schema.Types.Mixed,
  },
  { timestamps: true }
);

const MatchLogs = model("MatchLogs", matchLogsSchema);

module.exports = MatchLogs;

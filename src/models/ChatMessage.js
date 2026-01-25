const { Schema, model } = require("mongoose");

const chatMessageSchema = new Schema(
    {
        matchId: { type: Schema.Types.ObjectId, ref: "Match", required: true },
        sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
        type: {
            type: String,
            enum: ["text", "sticker"],
            default: "text",
        },
        content: { type: String, required: true, trim: true },
    },
    { timestamps: true }
);

const ChatMessage = model("ChatMessage", chatMessageSchema);

module.exports = ChatMessage;

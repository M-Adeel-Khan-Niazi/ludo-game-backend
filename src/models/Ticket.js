const { Schema, model } = require("mongoose");

const ticketSchema = new Schema(
    {
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        subject: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ["open", "in_progress", "resolved", "closed"],
            default: "open",
        },
        priority: {
            type: String,
            enum: ["low", "medium", "high"],
            default: "low",
        },
        messages: [
            {
                sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
                message: { type: String, required: true },
                createdAt: { type: Date, default: Date.now },
            },
        ],
    },
    { timestamps: true }
);

const Ticket = model("Ticket", ticketSchema);

module.exports = Ticket;

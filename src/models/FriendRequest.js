const { Schema, model } = require("mongoose");

const friendRequestSchema = new Schema(
    {
        sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
        receiver: { type: Schema.Types.ObjectId, ref: "User", required: true },
        status: {
            type: String,
            enum: ["pending", "accepted", "rejected"],
            default: "pending",
        },
    },
    { timestamps: true }
);

// Prevent duplicate pending requests
friendRequestSchema.index({ sender: 1, receiver: 1, status: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });

const FriendRequest = model("FriendRequest", friendRequestSchema);

module.exports = FriendRequest;

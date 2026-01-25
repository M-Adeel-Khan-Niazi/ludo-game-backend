const { Schema, model } = require("mongoose");

const reportSchema = new Schema(
    {
        reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
        reportedUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
        reason: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        status: {
            type: String,
            enum: ["pending", "reviewed", "resolved"],
            default: "pending",
        },
    },
    { timestamps: true }
);

const Report = model("Report", reportSchema);

module.exports = Report;

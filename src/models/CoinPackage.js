const { Schema, model } = require("mongoose");

const coinPackageSchema = new Schema(
    {
        title: { type: String, required: true, trim: true },
        pricePKR: { type: Number, default: 0 },
        priceUSD: { type: Number, default: 0 },
        isPopular: { type: Boolean, default: false },
        coins: { type: Number, default: 0 },
        bonusCoins: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true },
        appleProductId: { type: String, trim: true, default: "" },
        googleSku: { type: String, trim: true, default: "" },
    },
    { timestamps: true }
);

const CoinPackage = model("CoinPackage", coinPackageSchema);

module.exports = CoinPackage;

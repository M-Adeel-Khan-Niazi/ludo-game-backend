const CoinPackage = require("../models/CoinPackage");

class PackageService {
    /**
     * Create a new coin package
     * @param {Object} packageData
     */
    async createPackage(packageData) {
        const { title, pricePKR, priceUSD, isPopular, coins, bonusCoins } = packageData;
        const hasTitle = await CoinPackage.findOne({ title });
        if (hasTitle) {
            throw new Error("Package title already exists");
        }
        const hasPricePKR = await CoinPackage.findOne({ pricePKR });
        if (hasPricePKR) {
            throw new Error("Package pricePKR already exists");
        }
        const hasPriceUSD = await CoinPackage.findOne({ priceUSD });
        if (hasPriceUSD) {
            throw new Error("Package priceUSD already exists");
        }
        return await CoinPackage.create({
            title,
            pricePKR,
            priceUSD,
            isPopular,
            coins,
            bonusCoins,
        });
    }

    /**
     * Update a coin package
     * @param {String} id
     * @param {Object} updates
     */
    async updatePackage(id, updates) {
        const updatedPackage = await CoinPackage.findByIdAndUpdate(id, updates, {
            new: true,
        });
        if (!updatedPackage) {
            throw new Error("Package not found");
        }
        return updatedPackage;
    }

    /**
     * List coin packages
     * @param {Object} query
     */
    async listPackages(query = {}) {
        return await CoinPackage.find(query).sort({ pricePKR: 1 });
    }

    /**
     * Delete a coin package
     * @param {String} id
     */
    async deletePackage(id) {
        const deletedPackage = await CoinPackage.findByIdAndDelete(id);
        if (!deletedPackage) {
            throw new Error("Package not found");
        }
        return deletedPackage;
    }
}

module.exports = new PackageService();

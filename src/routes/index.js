const express = require("express");
const router = express.Router();

const authRoutes = require("./users/auth.route");
const walletRoutes = require("./users/wallet.route");

router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);


module.exports = router;

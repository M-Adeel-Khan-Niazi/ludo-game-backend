const express = require("express");
const router = express.Router();

const authRoutes = require("./users/auth.route");
const walletRoutes = require("./users/wallet.route");
const matchRoutes = require("./users/match.route");

router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/matches", matchRoutes);


module.exports = router;

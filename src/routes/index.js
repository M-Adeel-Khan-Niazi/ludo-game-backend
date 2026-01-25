const express = require("express");
const router = express.Router();

const authRoutes = require("./users/auth.route");
const walletRoutes = require("./users/wallet.route");
const matchRoutes = require("./users/match.route");
const supportRoutes = require("./users/support.route");

router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/matches", matchRoutes);
router.use("/support", supportRoutes);


module.exports = router;

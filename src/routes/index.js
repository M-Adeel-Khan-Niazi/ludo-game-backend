const express = require("express");
const router = express.Router();

const authRoutes = require("./users/auth.route");
const walletRoutes = require("./users/wallet.route");
const matchRoutes = require("./users/match.route");
const supportRoutes = require("./users/support.route");
const socialRoutes = require("./users/social.route");
const tournamentRoutes = require("./users/tournament.route");

router.use("/auth", authRoutes);
router.use("/wallet", walletRoutes);
router.use("/matches", matchRoutes);
router.use("/support", supportRoutes);
router.use("/social", socialRoutes);
router.use("/tournaments", tournamentRoutes);


module.exports = router;

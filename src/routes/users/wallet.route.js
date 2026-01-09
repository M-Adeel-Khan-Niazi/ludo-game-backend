const express = require("express");
const router = express.Router();
const WalletController = require("../../controllers/wallet.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

router.get("/history", authenticateJwt, WalletController.getHistory.bind(WalletController));
router.get("/balance", authenticateJwt, WalletController.getBalance.bind(WalletController));

module.exports = router;


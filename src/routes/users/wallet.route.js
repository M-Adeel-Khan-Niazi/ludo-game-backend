const express = require("express");
const router = express.Router();
const WalletController = require("../../controllers/WalletController");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

router.get("/history", authenticateJwt, WalletController.getHistory);
router.get("/balance", authenticateJwt, WalletController.getBalance);

module.exports = router;


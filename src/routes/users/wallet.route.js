const express = require("express");
const router = express.Router();
const WalletController = require("../../controllers/wallet.controller");
const PackageController = require("../../controllers/package.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");

router.get(
  "/history",
  authenticateJwt,
  WalletController.getHistory.bind(WalletController),
);
router.get(
  "/balance",
  authenticateJwt,
  WalletController.getBalance.bind(WalletController),
);

// Package routes for users
router.get(
  "/packages",
  authenticateJwt,
  PackageController.listPackages.bind(PackageController),
);
router.get(
  "/app-packages",
  authenticateJwt,
  PackageController.appPackages.bind(PackageController),
);
router.post(
  "/buy-package",
  authenticateJwt,
  WalletController.buyPackage.bind(WalletController),
);
router.get(
  "/purchase-history",
  authenticateJwt,
  WalletController.getPurchaseHistory.bind(WalletController),
);

module.exports = router;

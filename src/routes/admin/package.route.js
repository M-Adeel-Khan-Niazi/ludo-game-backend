const express = require("express");
const router = express.Router();
const PackageController = require("../../controllers/package.controller");
const { authenticateJwt, restrictTo } = require("../../middlewares/auth.middleware");

router.post(
    "/",
    authenticateJwt,
    restrictTo("admin"),
    PackageController.createPackage.bind(PackageController)
);

router.put(
    "/:id",
    authenticateJwt,
    restrictTo("admin"),
    PackageController.updatePackage.bind(PackageController)
);

router.delete(
    "/:id",
    authenticateJwt,
    restrictTo("admin"),
    PackageController.deletePackage.bind(PackageController)
);

router.get(
    "/",
    authenticateJwt,
    restrictTo("admin"),
    PackageController.listPackages.bind(PackageController)
);

module.exports = router;

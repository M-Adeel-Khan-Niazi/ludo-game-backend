const express = require("express");
const router = express.Router();
const AdminUserController = require("../../controllers/adminUser.controller");
const { authenticateJwt, restrictTo } = require("../../middlewares/auth.middleware");

// All routes are protected and restricted to admin
router.use(authenticateJwt);
router.use(restrictTo("admin"));

// List users
router.get("/", AdminUserController.listUsers.bind(AdminUserController));

// User details
router.get("/:id", AdminUserController.getUserDetail.bind(AdminUserController));

// Toggle active status
router.patch("/:id/status", AdminUserController.toggleStatus.bind(AdminUserController));

// Soft delete user
router.delete("/:id", AdminUserController.softDelete.bind(AdminUserController));

module.exports = router;

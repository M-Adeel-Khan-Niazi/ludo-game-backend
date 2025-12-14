const express = require("express");
const router = express.Router();

const authRoutes = require("./users/auth.route");

router.use("/auth", authRoutes);


module.exports = router;

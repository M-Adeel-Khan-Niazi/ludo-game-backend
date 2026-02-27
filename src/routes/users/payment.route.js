const express = require("express");
const router = express.Router();
const PaymentController = require("../../controllers/payment.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");


// Create payment intent
router.post("/", authenticateJwt, PaymentController.createPayment);

// Payment webhook - Note: Stripe requires the raw body to verify signatures.
// express.raw({type: "application/json"}) should only be used for this specific route.
router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    PaymentController.webhook
);

module.exports = router;

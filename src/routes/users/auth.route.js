const router = require("express").Router();
const controller = require("../../controllers/auth.controller");
const { authenticateJwt } = require("../../middlewares/auth.middleware");
const upload = require("../../middlewares/multer-middleware");

// Check availability (public endpoint)
router.post(
  "/check-availability",
  controller.checkAvailability.bind(controller)
);

// Signup routes
router.post(
  "/signup/user",
  upload.single("avatar"),
  controller.signUpUser.bind(controller)
);

// Signin routes
router.post("/sign-in", controller.signIn.bind(controller));

// OTP routes
router.post("/forgot-password", controller.forgotPassword.bind(controller));
router.patch("/reset-password", controller.resetPassword.bind(controller));
router.post("/verify-otp", controller.verifyOTP.bind(controller));
router.post("/resend-otp", controller.resendOTP.bind(controller));

// Social login
router.post("/social-sign-in", controller.socialLogin.bind(controller));

// Signout
router.delete(
  "/sign-out",
  authenticateJwt,
  controller.signOut.bind(controller)
);

// Language setting
router.patch(
  "/set-language",
  authenticateJwt,
  controller.setLanguage.bind(controller)
);

// Profile
router.patch(
  "/profile",
  upload.single("avatar"),
  authenticateJwt,
  controller.updateProfile.bind(controller)
);
router.get("/profile", authenticateJwt, controller.getProfile.bind(controller));
router.patch(
  "/change-password",
  authenticateJwt,
  controller.updatePassword.bind(controller)
);
router.delete(
  "/delete-account",
  authenticateJwt,
  controller.deleteAccount.bind(controller)
);

module.exports = router;

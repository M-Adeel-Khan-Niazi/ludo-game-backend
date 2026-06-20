require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV,
  APP_NAME: process.env.APP_NAME,
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,

  // ─── IAP Receipt Verification ─────────────────────────────────────────────
  // Currently UNUSED — IapService.verifyReceiptWithStore() is a stub that trusts
  // the receipt. Fill these in and complete the verifier to enable real checks.
  // APPLE (App Store Server API):
  APPLE_ISSUER_ID: process.env.APPLE_ISSUER_ID || "",
  APPLE_KEY_ID: process.env.APPLE_KEY_ID || "",
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY || "",
  APPLE_BUNDLE_ID: process.env.APPLE_BUNDLE_ID || "",
  // GOOGLE (Play Developer API):
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "",
  ANDROID_PACKAGE_NAME: process.env.ANDROID_PACKAGE_NAME || "",
  // ──────────────────────────────────────────────────────────────────────────

  UPLOAD_API_TOKEN: process.env.UPLOAD_API_TOKEN,
  AGORA_APP_ID: process.env.AGORA_APP_ID,
  AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE,
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  TWILIO_VERIFY_SERVICE_ID: process.env.TWILIO_VERIFY_SERVICE_ID,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FROM_EMAIL: process.env.FROM_EMAIL,
  RESEND_KEY: process.env.RESEND_KEY,
  BOT_ENABLED: process.env.BOT_ENABLED !== "false",
  BOT_FILL_DELAY_MS: parseInt(process.env.BOT_FILL_DELAY_MS, 10) || 20000,
  BOT_TURN_START_DELAY_MS: parseInt(process.env.BOT_TURN_START_DELAY_MS, 10) || 2000,
  BOT_POST_ROLL_DELAY_MS: parseInt(process.env.BOT_POST_ROLL_DELAY_MS, 10) || 1500,
  BOT_BONUS_TURN_DELAY_MS: parseInt(process.env.BOT_BONUS_TURN_DELAY_MS, 10) || 1000,
  BOT_CONTINUE_MOVE_DELAY_MS: parseInt(process.env.BOT_CONTINUE_MOVE_DELAY_MS, 10) || 1500,
};

const twilio = require("twilio");
const logger = require("./logger");
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = require("./env");

// Twilio configuration
const accountSid = TWILIO_ACCOUNT_SID;
const authToken = TWILIO_AUTH_TOKEN;
const fromNumber = TWILIO_PHONE_NUMBER;

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Function to send SMS
const sendSMS = async (to, message) => {
  try {
    const result = await client.messages.create({
      body: message,
      from: fromNumber,
      to: to,
    });

    logger.info(`SMS sent successfully to ${to}. SID: ${result.sid}`);
    return { success: true, sid: result.sid };
  } catch (error) {
    logger.error(`Failed to send SMS to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { sendSMS };

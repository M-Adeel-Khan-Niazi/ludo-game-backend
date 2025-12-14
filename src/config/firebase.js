const admin = require("firebase-admin");
const { handlers } = require("../utils/response-handlers");
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = require("./env");
const logger = require("./logger");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY,
  }),
});

const sendNotification = async (payload) => {
  const { deviceToken, title, body, data = {} } = payload;
  try {
    const message = {
      token: deviceToken,
      notification: {
        title,
        body,
      },
      data: { ...data },
    };

    const response = await admin
      .messaging()
      .send(message)
      .catch((error) => {
        logger.error(error.message);
      });
    logger.success("Notification sent successfully");
    return response;
  } catch (error) {
    logger.error(error.message);
    return logger.error({ message: error.message });
  }
};

const sendCallNotification = async (payload) => {
  const { deviceToken, title, body, data = {} } = payload;
  try {
    const message = {
      token: deviceToken,
      notification: {
        title,
        body,
      },
      data: { ...data, sound: "default" },
    };

    const response = await admin
      .messaging()
      .send(message)
      .catch((error) => {
        handlers.logger.error({ message: error });
      });
    handlers.logger.success({ message: "Call notification sent successfully" });
    return response;
  } catch (error) {
    handlers.logger.error({ message: error });
    return handlers.response.error({ message: error.message });
  }
};

module.exports = { sendNotification, sendCallNotification };

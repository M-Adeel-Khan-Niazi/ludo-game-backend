const nodemailer = require("nodemailer");
const { AUTH_EMAIL, APP_PASSWORD } = require("./env");
const logger = require("./logger");

const host = "smtp.gmail.com";
const port = 587;
const secure = false;
const user = AUTH_EMAIL;
const pass = APP_PASSWORD;

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  auth: { user, pass },
});

const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const mailOptions = {
      from: user,
      to,
      subject,
      text,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.success(info.messageId);
    return info;
  } catch (error) {
    return logger.error(error.message);
  }
};

module.exports = sendEmail;

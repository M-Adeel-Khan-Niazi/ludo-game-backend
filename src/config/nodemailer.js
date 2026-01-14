const { Resend } = require("resend");
const { FROM_EMAIL, RESEND_KEY } = require("./env");
const logger = require("./logger");
const resend = new Resend(RESEND_KEY);

const sendEmail = async (to, subject, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      return console.error({ error });
    }

    logger.success(data.id);
    return data;
  } catch (error) {
    return logger.error(error.message);
  }
};

module.exports = sendEmail;

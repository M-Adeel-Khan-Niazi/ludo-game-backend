const { validationResult } = require("express-validator");
const { handlers } = require("../utils/response-handlers");

exports.validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map((v) => v.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return handlers.response.failed({ res, error: errors.array() });
    }
    next();
  };
};

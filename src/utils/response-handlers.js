const logger = require("../config/logger");

exports.handlers = {
  response: {
    success: ({ res, code = 200, success = true, message, data = null }) => {
      return res.status(code).send({
        success,
        statusCode: code,
        message,
        data,
      });
    },
    failed: ({ res, code = 400, success = false, message, error = null }) => {
      logger.warn({ code, success, message, error });
      return res.status(code).send({
        success,
        message,
        error,
      });
    },
    error: ({ res, code = 500, success = false, message, error = null }) => {
      logger.error({ code, success, message, error });
      return res.status(code).send({
        success,
        message,
        error,
      });
    },
    unavailable: ({
      res,
      code = 404,
      success = false,
      message,
      data = null,
    }) => {
      logger.error({ code, success, message, data });
      return res.status(code).send({
        success,
        message,
        data,
      });
    },
    unauthorized: ({
      res,
      code = 401,
      success = false,
      message,
      error = null,
    }) => {
      logger.warn({ code, success, message, error });
      return res.status(code).send({
        success,
        message,
        error,
      });
    },
  },
  event: {
    success: ({
      object_type,
      code = 200,
      success = true,
      message,
      data = null,
    }) => {
      return {
        object_type,
        code,
        success,
        message,
        data,
      };
    },
    failed: ({
      object_type,
      code = 400,
      success = false,
      message,
      error = null,
    }) => {
      return {
        object_type,
        code,
        success,
        message,
        error,
      };
    },
    error: ({
      object_type,
      code = 500,
      success = false,
      message,
      error = null,
    }) => {
      return {
        object_type,
        code,
        success,
        message,
        error,
      };
    },
    unavailable: ({
      object_type,
      code = 404,
      success = false,
      message,
      data = null,
    }) => {
      return {
        object_type,
        code,
        success,
        message,
        data,
      };
    },
    unauthorized: ({
      object_type,
      code = 401,
      success = false,
      message,
      error = null,
    }) => {
      return {
        object_type,
        code,
        success,
        message,
        error,
      };
    },
  },
};

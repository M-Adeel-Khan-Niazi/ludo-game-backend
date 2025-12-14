const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const routes = require("./routes");
const { errorHandler } = require("./middlewares/error.middleware");
const passport = require("./config/pasport");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const requestLogger = require("./middlewares/requestLogger");
const app = express();

app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(morgan("dev"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(passport.initialize());
app.use(requestLogger);

// routes
app.use("/api/v1", routes);

// error handler
app.use(errorHandler);

module.exports = app;

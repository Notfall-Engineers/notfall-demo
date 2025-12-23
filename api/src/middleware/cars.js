// api/src/middleware/cars.js
// CARS = Correlation, Audit, Request Summary 
const { randomUUID } = require("crypto");
const logger = require("../config/logger");

function cars(req, res, next) {
  const start = Date.now();

  // Correlation ID
  const incomingId =
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    null;
  const id = incomingId || randomUUID();

  req.id = id;
  res.setHeader("x-request-id", id);

  // Basic request context
  const baseLog = {
    id,
    method: req.method,
    path: req.originalUrl || req.url,
  };

  logger.info(baseLog, "Incoming request");

  res.on("finish", () => {
    const duration = Date.now() - start;
    logger.info(
      {
        ...baseLog,
        statusCode: res.statusCode,
        durationMs: duration,
      },
      "Request completed"
    );
  });

  next();
}

module.exports = cars;

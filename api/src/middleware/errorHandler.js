// src/middleware/errorHandler.js
export function errorHandler(err, _req, res, _next) {
  console.error(err);
  res
    .status(500)
    .json({ error: "server_error", message: err.message || "Unexpected error" });
}

// src/config/logger.js
// Minimal logger for the notfall-demo API (ESM-compatible)

const logger = {
  info: (...args) => console.log("[INFO ]", ...args),
  warn: (...args) => console.warn("[WARN ]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

export { logger };
export default logger;

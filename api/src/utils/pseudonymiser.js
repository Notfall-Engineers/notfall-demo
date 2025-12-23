// utils/pseudonymiser.js
// Simple, deterministic pseudonymiser (salt required in env)

import crypto from "crypto";

const SALT = process.env.PSEUDONYMISER_SALT || "change-me";

/**
 * Pseudonymise an identifier (email, userId, wallet, etc.)
 * Returns a stable 24-char hex string.
 */
export function id(v) {
  if (!v) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return crypto
    .createHmac("sha256", SALT)
    .update(s)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Shallow redact common fields on an object.
 * (email, wallet, userId) are pseudonymised, everything
 * else is left intact.
 */
export function redact(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));

  if (clone.email) clone.email = id(clone.email);
  if (clone.wallet) clone.wallet = id(clone.wallet);
  if (clone.userId) clone.userId = id(clone.userId);

  return clone;
}

// Default export for consumers that expect Pseudo.id / Pseudo.redact
const Pseudo = { id, redact };
export default Pseudo;

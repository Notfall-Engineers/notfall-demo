// api/src/middleware/validateWaitlist.js

// Allowed persona values – you can tweak as needed
const ALLOWED_PERSONAS = new Set([
  "fm",        // FM / Property manager
  "landlord",
  "engineer",
  "industrial",
  "partner",
  "other"
]);

/**
 * Basic validation & sanitisation for the waitlist payload.
 * If invalid, responds with 400 and a list of messages.
 */
function validateWaitlist(req, res, next) {
  const body = req.body || {};

  let {
    fullName,
    workEmail,
    persona,
    region,
    interests,
    tenOutOfTen,
    referrer
  } = body;

  const errors = [];

  function normaliseRequiredString(value, field, max = 160) {
    if (typeof value !== "string") {
      errors.push(`${field} is required`);
      return "";
    }
    const trimmed = value.trim();
    if (!trimmed) {
      errors.push(`${field} is required`);
      return "";
    }
    if (trimmed.length > max) {
      errors.push(`${field} is too long (max ${max} characters)`);
    }
    return trimmed.slice(0, max);
  }

  function normaliseOptionalString(value, max = 280) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.length > max) {
      return trimmed.slice(0, max);
    }
    return trimmed;
  }

  // Required core fields
  fullName = normaliseRequiredString(fullName, "fullName", 120);
  workEmail = normaliseRequiredString(workEmail, "workEmail", 160);
  region = normaliseRequiredString(region, "region", 160);

  // Very light email check – enough for validation without being too strict
  const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (workEmail && !emailRegex.test(workEmail)) {
    errors.push("workEmail must be a valid email address");
  }

  // Persona
  if (typeof persona !== "string" || !persona.trim()) {
    errors.push("persona is required");
  } else {
    persona = persona.trim();
    if (!ALLOWED_PERSONAS.has(persona)) {
      errors.push(
        `persona must be one of: ${Array.from(ALLOWED_PERSONAS).join(", ")}`
      );
    }
  }

  // Interests: accept either comma-separated string or array
  if (Array.isArray(interests)) {
    interests = interests
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
  } else if (typeof interests === "string") {
    interests = interests
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  } else {
    interests = [];
  }

  // Optional fields
  tenOutOfTen = normaliseOptionalString(tenOutOfTen, 280);
  referrer = normaliseOptionalString(referrer, 120);

  if (errors.length) {
    return res.status(400).json({
      status: "error",
      errors
    });
  }

  // 🔑 Keep all sanitised fields on req.body
  req.body = {
    fullName,
    workEmail,
    persona,
    region,
    interests,
    tenOutOfTen,
    referrer
  };

  return next();
}

export default validateWaitlist;

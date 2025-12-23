// api/src/utils/generateToken.js
import jwt from "jsonwebtoken";

/**
 * Generate a signed JWT for a given user id.
 *
 * extras can include:
 *  - role
 *  - mfaVerified
 *  - rememberMe
 */
const generateToken = (id, extras = {}) => {
  const secret = process.env.JWT_SECRET || "dev-secret-change-me";
  const expiresIn = extras.rememberMe ? "30d" : "7d";

  const payload = {
    id,
    role: extras.role,
    mfaVerified: extras.mfaVerified ?? false,
  };

  return jwt.sign(payload, secret, { expiresIn });
};

export default generateToken;
export { generateToken };

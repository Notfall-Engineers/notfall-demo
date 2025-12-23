// api/src/routes/loginRoute.js
import express from "express";
import speakeasy from "speakeasy";
import User from "../models/userModel.js";
import { generateToken } from "../utils/generateToken.js";

const router = express.Router();

/**
 * POST /api/auth/login
 * body: { email, password, mfaCode? }
 */
router.post("/login", async (req, res, next) => {
  try {
    const { email, password, mfaCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .select("+password +mfaSecret +mfaBackupCodes");

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const match = await user.matchPassword(password);
    if (!match) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // If MFA is enabled, we require a valid TOTP code
    if (user.mfaEnabled && user.mfaSecret) {
      if (!mfaCode) {
        return res.status(403).json({
          message: "MFA code required",
          mfaRequired: true,
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: "base32",
        token: mfaCode,
        window: 1, // allow small clock drift
      });

      if (!verified) {
        return res.status(401).json({
          message: "Invalid MFA code",
          mfaRequired: true,
        });
      }
    }

    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * OPTIONAL: Endpoint to enable MFA later
 * POST /api/auth/mfa/enable  (protected)
 * For now we keep it out of the wiring to avoid new errors.
 */

export default router;

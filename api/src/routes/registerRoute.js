// api/src/routes/registerRoute.js
import express from "express";
import User from "../models/userModel.js";
import { generateToken } from "../utils/generateToken.js";

const router = express.Router();

/**
 * POST /api/auth/register
 * body: { name, email, password, role? }
 */
router.post("/register", async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password required" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: "User already exists" });
    }

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: role || "client",
    });

    const token = generateToken(user);

    res.status(201).json({
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

export default router;

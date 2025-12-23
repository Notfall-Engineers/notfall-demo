// api/src/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import User from "../models/userModel.js";

/**
 * Protect – require a valid JWT (Authorization: Bearer <token>)
 * Populates req.user with the user object (minus password).
 */
export async function protect(req, res, next) {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorised, no token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = await User.findById(decoded.id).select(
      "-password -mfaSecret -mfaBackupCodes"
    );

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "User not found or inactive" });
    }

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
    };

    next();
  } catch (err) {
    console.error("protect() error:", err.message);
    return res.status(401).json({ message: "Not authorised, token failed" });
  }
}

/**
 * Role-based access control
 * Usage: app.get("/api/widgets/engineer", protect, requireRole("engineer","admin"), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorised" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Forbidden - insufficient role",
        required: allowedRoles,
        current: req.user.role,
      });
    }
    next();
  };
}

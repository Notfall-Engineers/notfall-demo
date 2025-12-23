// src/middleware/requireDemoUser.js

/**
 * Demo-only auth layer.
 * We simply attach a fake user object using the 'x-demo-user' header.
 * 
 * Frontend can send:
 *    x-demo-user: engineer_001
 * or x-demo-user: client_001
 * or x-demo-role: "ENGINEER" | "CLIENT" | "DAO"
 */

export function requireDemoUser(req, res, next) {
  const userId = req.header("x-demo-user") || "demo_user_001";
  const role = req.header("x-demo-role") || "CLIENT";

  req.user = {
    id: userId,
    role
  };

  next();
}

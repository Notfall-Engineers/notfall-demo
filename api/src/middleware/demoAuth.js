// src/middleware/demoAuth.js
// Injects a demo user based on x-demo-role for the HTML cockpit.

export function demoAuth(req, res, next) {
  const demoRoleHeader = req.header("x-demo-role");
  if (!demoRoleHeader) {
    return next();
  }

  const role = demoRoleHeader.toUpperCase();

  // Use fixed 24-char hex strings so Mongoose treats them as valid ObjectIds
  let userId = null;
  if (role === "ENGINEER") {
    userId = "00000000000000000000e001";
  } else if (role === "CLIENT" || role === "CLIENT_FM") {
    userId = "00000000000000000000c001";
  } else if (role === "DAO_ADMIN") {
    userId = "00000000000000000000d001";
  }

  req.user = {
    _id: userId,
    role,
    email:
      role === "ENGINEER"
        ? "demo.engineer@notfall.local"
        : role === "DAO_ADMIN"
        ? "demo.dao@notfall.local"
        : "demo.client@notfall.local",
    name:
      role === "ENGINEER"
        ? "Demo Engineer"
        : role === "DAO_ADMIN"
        ? "DAO Guardian"
        : "FM Client",
    isDemo: true,
  };

  next();
}

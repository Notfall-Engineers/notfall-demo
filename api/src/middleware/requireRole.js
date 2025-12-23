// src/middleware/requireRole.js
export function requireRole(...allowed) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: "forbidden", detail: "role_not_allowed" });
    }
    next();
  };
}

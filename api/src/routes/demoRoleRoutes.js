// api/src/routes/demoRoleRoutes.js
import express from "express";

const router = express.Router();

// super simple in-memory role store per browser (falls back to header)
let lastRole = "ENGINEER";

router.get("/", (req, res) => {
  res.json({ role: lastRole });
});

router.post("/", (req, res) => {
  const role = (req.body?.role || "").toUpperCase();
  if (!["ENGINEER", "CLIENT", "DAO_ADMIN"].includes(role)) {
    return res.status(400).json({ error: "invalid_role" });
  }
  lastRole = role;
  res.json({ role });
});

export default router;

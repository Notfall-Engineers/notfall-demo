// api/src/routes/demoRoutes.js
import express from "express";
import { postTelemetry } from "../controllers/telemetryController.js";

const router = express.Router();

/**
 * Demo utility routes.
 * Backwards-compat only:
 * FakeAPI.js "best-effort posts" to:
 *   - POST /api/demo/telemetry (older variant)
 *
 * We keep this endpoint to prevent 404 spam and keep the demo smooth.
 */

// ✅ Backwards-compatible telemetry sink
router.post("/telemetry", postTelemetry);

// Tiny banner to confirm mounting works
router.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "notfall-demo",
    message: "Demo routes mounted",
    timestamp: new Date().toISOString(),
  });
});

export default router;

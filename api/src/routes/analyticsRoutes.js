// src/routes/analyticsRoutes.js
import { Router } from "express";

export function buildAnalyticsRoutes({ analytics }) {
  const router = Router();

  // Basic validation helper
  function okEvent(e) {
    return e && typeof e === "object" && typeof e.event_name === "string";
  }

  router.get("/health", (req, res) => {
    res.json({ ok: true, health: analytics?.getHealth?.() || { enabled: false } });
  });

  router.get("/deadletter", (req, res) => {
    // expose only summary counts (no payloads)
    const dlq = analytics?.deadLetter || [];
    res.json({
      ok: true,
      deadLetter: dlq.slice(-50) // last 50 summaries only
    });
  });

  router.post("/event", (req, res) => {
    const ev = req.body;
    if (!okEvent(ev)) return res.status(400).json({ ok: false, error: "Invalid event" });

    analytics?.enqueue?.(ev);
    res.json({ ok: true });
  });

  router.post("/batch", (req, res) => {
    const arr = req.body;
    if (!Array.isArray(arr)) return res.status(400).json({ ok: false, error: "Expected array" });

    let accepted = 0;
    for (const e of arr) {
      if (!okEvent(e)) continue;
      analytics?.enqueue?.(e);
      accepted++;
    }

    res.json({ ok: true, accepted });
  });

  router.post("/flush", async (req, res) => {
    try {
      await analytics?.flush?.();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "Flush failed" });
    }
  });

  return router;
}

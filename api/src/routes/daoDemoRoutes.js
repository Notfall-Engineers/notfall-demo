// api/src/routes/daoDemoRoutes.js
import express from "express";
import * as DSSAdapter from "../services/DSSAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";

const router = express.Router();

/**
 * DAO Demo Routes (merged + deduped)
 * - Keeps ONE copy of each handler
 * - Normalises "actor" resolution
 * - Broadcasts to WS topic: "daoCourt" for courtroom widgets
 * - Logs runs/events via DSSAdapter
 *
 * NOTE:
 * Your AuditLog / DSS severity enum must include: "info" and "warning".
 */

function getActor(req) {
  return req.user?._id?.toString?.() || "demo-dao-guardian";
}

function getUA(req) {
  return req.headers["user-agent"] || "";
}

/**
 * GET /api/dao-demo/review-queue
 * Simple static/demo queue for the DAO widget (DAO Judge view).
 */
router.get("/review-queue", async (req, res, next) => {
  const db = req.app.get("models");

  try {
    const actor = getActor(req);

    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: actor,
      scope: "daoDemo:queue:list",
      meta: { source: "daoJudgeWidget" },
    });

    const queue = [
      {
        id: "ENG-DEMO-001",
        name: "Demo Engineer",
        trade: "HVAC",
        submittedAt: new Date().toISOString(),
        kycStatus: "verified",
        daoStatus: "PENDING",
        notes: "Demo submission for Level39 cockpit",
      },
    ];

    await DSSAdapter.recordEvent(db, runId, "daoDemo", "queue:list", {
      severity: "info",
      actor,
      meta: { count: queue.length },
      ip: req.ip,
      userAgent: getUA(req),
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    res.json(queue);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/dao-demo/review-queue/:id/approve
 * Demo-only approve endpoint – no DB write, but logs + WebSocket.
 */
router.post("/review-queue/:id/approve", async (req, res, next) => {
  const db = req.app.get("models");
  const { id } = req.params;
  const { note } = req.body || {};

  try {
    const actor = getActor(req);

    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: actor,
      scope: "daoDemo:approve",
      meta: { engineerId: id },
    });

    await DSSAdapter.recordEvent(db, runId, "daoDemo", "approve", {
      severity: "info",
      actor,
      message: "Demo DAO approval",
      meta: { engineerId: id, note },
      ip: req.ip,
      userAgent: getUA(req),
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // 🔔 Broadcast to DAO Judge / courtroom widgets
    widgetBus.broadcastWidgetEvent({
      topic: "daoCourt",
      action: "approved",
      payload: {
        engineerId: id,
        note: note || null,
        decidedBy: actor,
        decidedAt: new Date().toISOString(),
      },
    });

    res.json({ ok: true, status: "APPROVED", engineerId: id });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/dao-demo/review-queue/:id/reject
 * Demo-only reject endpoint – no DB write, but logs + WebSocket.
 */
router.post("/review-queue/:id/reject", async (req, res, next) => {
  const db = req.app.get("models");
  const { id } = req.params;
  const { note } = req.body || {};

  try {
    const actor = getActor(req);

    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: actor,
      scope: "daoDemo:reject",
      meta: { engineerId: id },
    });

    await DSSAdapter.recordEvent(db, runId, "daoDemo", "reject", {
      severity: "warning",
      actor,
      message: "Demo DAO rejection",
      meta: { engineerId: id, note },
      ip: req.ip,
      userAgent: getUA(req),
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // 🔔 Broadcast to DAO Judge / courtroom widgets
    widgetBus.broadcastWidgetEvent({
      topic: "daoCourt",
      action: "rejected",
      payload: {
        engineerId: id,
        note: note || null,
        decidedBy: actor,
        decidedAt: new Date().toISOString(),
      },
    });

    res.json({ ok: true, status: "REJECTED", engineerId: id });
  } catch (err) {
    next(err);
  }
});

export default router;

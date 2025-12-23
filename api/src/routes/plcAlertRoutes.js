import express from "express";
import PlcAlert from "../models/plcAlertModel.js";
import DSSAdapter from "../services/DSSAdapter.js";

const router = express.Router();

// Attach DSS runId
router.use((req, res, next) => DSSAdapter.applyRequestGuards(req, res, next));

/**
 * GET /api/plc-alerts
 * ?propertyId=... (required)
 * ?status=open|dispatched|...
 */
router.get("/", async (req, res, next) => {
  const db = req.app.get("models");
  const { propertyId, status } = req.query;

  if (!propertyId) {
    return res.status(400).json({ message: "propertyId is required" });
  }

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: req.user?._id?.toString() || null,
      scope: "plcAlerts:list",
      meta: { propertyId, status },
    });

    const query = { propertyId };
    if (status) query.status = status;

    const alerts = await PlcAlert.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    await DSSAdapter.recordEvent(db, runId, "plcAlerts", "list", {
      severity: "info",
      actor: req.user?._id?.toString(),
      meta: { propertyId, status, count: alerts.length },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    res.json(alerts);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/plc-alerts/:id
 * Update status (acknowledged, dispatched, resolved, ignored)
 */
router.patch("/:id", async (req, res, next) => {
  const db = req.app.get("models");
  const { id } = req.params;
  const { status, engineerId, taskId } = req.body;

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: req.user?._id?.toString() || null,
      scope: "plcAlerts:update",
      meta: { alertId: id, status, engineerId, taskId },
    });

    const alert = await PlcAlert.findById(id);
    if (!alert) return res.status(404).json({ message: "PLC alert not found" });

    if (status) alert.status = status;
    if (engineerId) alert.engineerId = engineerId;
    if (taskId) alert.taskId = taskId;

    await alert.save();

    await DSSAdapter.recordEvent(db, runId, "plcAlerts", "update", {
      severity: "info",
      actor: req.user?._id?.toString(),
      meta: {
        alertId: alert._id.toString(),
        propertyId: alert.propertyId.toString(),
        status: alert.status,
        engineerId: alert.engineerId?.toString(),
        taskId: alert.taskId?.toString(),
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    res.json(alert);
  } catch (err) {
    next(err);
  }
});

export default router;

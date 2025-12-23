// controllers/workflowController.js
import * as DSSAdapter from "../services/DSSAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";
import PlcAlert from "../models/plcAlertModel.js";
import Task from "../models/taskModel.js";
import Rams from "../models/ramsModel.js"; // if you have one

export async function handlePLCAlert(req, res, next) {
  const db = req.app.get("models");

  try {
    const { propertyId, assetId, plcTag, faultCode, severity, payload } =
      req.body || {};

    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: null,
      scope: "plcAlert:ingest",
      meta: { propertyId, assetId, faultCode, severity },
    });

    const alert = await PlcAlert.create({
      propertyId,
      assetId,
      plcTag,
      faultCode,
      severity,
      rawPayload: payload,
      status: "open",
    });

    await DSSAdapter.recordEvent(db, runId, "plcAlert", "raised", {
      severity: severity?.toLowerCase?.() === "critical" ? "high" : "info",
      message: "PLC alert ingested",
      meta: {
        alertId: alert._id.toString(),
        propertyId,
        assetId,
        plcTag,
        faultCode,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // 🔔 Broadcast to widgets: Asset registry, PLC map, Dispatch panel
    widgetBus.broadcastWidgetEvent({
      topic: "plcAlert",
      action: "created",
      payload: {
        id: alert._id.toString(),
        propertyId,
        assetId,
        faultCode,
        severity,
        status: alert.status,
        createdAt: alert.createdAt,
      },
    });

    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
}

/**
 * Update RAMS status for a given task.
 * Called after RAMS is created / updated / approved.
 */
export async function updateRamsStatus(req, res, next) {
  const db = req.app.get("models");
  const { taskId } = req.params;
  const { status, version, notes } = req.body || {};
  const actorId = req.user?._id?.toString?.() || "system";

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: actorId,
      scope: "rams:updateStatus",
      meta: { taskId, status, version },
    });

    const task = await Task.findById(taskId);
    if (!task) {
      await DSSAdapter.finishRun(db, runId, { status: "failed" });
      return res.status(404).json({ error: "not_found" });
    }

    const rams = await Rams.findOneAndUpdate(
      { taskId },
      {
        $set: {
          status: status || "DRAFT",
          version: version || 1,
          notes: notes || "",
          updatedBy: actorId,
        },
      },
      { upsert: true, new: true }
    );

    await DSSAdapter.recordEvent(db, runId, "rams", "statusUpdated", {
      severity: "info",
      actor: actorId,
      meta: {
        taskId: task._id.toString(),
        engineerId: task.assignedEngineer?.toString?.() || null,
        status: rams.status,
        version: rams.version,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // 🔔 Broadcast RAMS update for badges/indicators
    widgetBus.broadcastWidgetEvent({
      topic: "rams",
      action: "updated",
      payload: {
        taskId: task._id.toString(),
        engineerId: task.assignedEngineer?.toString?.() || null,
        status: rams.status,
        version: rams.version,
        updatedAt: rams.updatedAt,
      },
    });

    res.json(rams);
  } catch (err) {
    next(err);
  }
}

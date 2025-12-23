// services/DispatchEngineService.js
import * as DSSAdapter from "./DSSAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";
import Task from "../models/taskModel.js";

/**
 * Offer a ticket to a ranked list of engineers.
 * - Writes offeredEngineers[] on Task (so backend can enforce first-accept-wins).
 * - Broadcasts WebSocket events to the specific engineerIds.
 */
export async function offerTicketToEngineers({
  db,
  taskId,
  rankedEngineers, // array of engineer docs or {_id, displayName, primaryTrade}
  reqContext = {},
}) {
  if (!taskId || !Array.isArray(rankedEngineers) || rankedEngineers.length === 0) {
    throw new Error("offerTicketToEngineers requires taskId and rankedEngineers");
  }

  const task = await Task.findById(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const engineerIds = rankedEngineers.map((e) => e._id.toString());

  const runId = await DSSAdapter.startRun(db, {
    initiatedBy: reqContext.actorId || null,
    scope: "ticket:offer",
    meta: {
      taskId: task._id.toString(),
      engineerIds,
    },
  });

  // Persist offer list (for first-accept-wins enforcement)
  task.offeredEngineers = engineerIds;
  task.status = task.status === "NEW" ? "OFFERED" : task.status;
  await task.save();

  await DSSAdapter.recordEvent(db, runId, "ticket", "offerCreated", {
    severity: "info",
    message: "Ticket offered to ranked engineers",
    meta: {
      taskId: task._id.toString(),
      engineerIds,
    },
    ip: reqContext.ip,
    userAgent: reqContext.userAgent,
    actor: reqContext.actorId || null,
  });

  await DSSAdapter.finishRun(db, runId, { status: "completed" });

  // 🔔 WebSocket – send to all candidate engineers
  widgetBus.broadcastWidgetEvent({
    topic: "ticket",
    action: "offered",
    payload: {
      taskId: task._id.toString(),
      code: task.code || task.workflowId || task._id.toString(),
      title: task.summary || task.title,
      siteName: task.siteName,
      severity: task.severity || "Medium",
      trade: task.trade || task.primaryTrade || "Multi-trade",
      slaHours: task.slaHours || 2,
      etaMinutes: task.etaMinutes || 30,
      offeredEngineers: engineerIds,
      createdAt: task.createdAt,
    },
  });

  return { ok: true, taskId: task._id.toString(), engineerIds };
}

/**
 * Called when an engineer accepts a ticket.
 * Back-end route should:
 *  - Check engineer is in offeredEngineers.
 *  - Check task.assignedEngineer is still null.
 *  - Then set assignedEngineer and clear other offers.
 *
 * This function is not doing the accept itself – that stays in the
 * engineerDashboardController – but here we provide a WebSocket helper.
 */
export async function broadcastTicketAccepted({ task, engineer }) {
  widgetBus.broadcastWidgetEvent({
    topic: "ticket",
    action: "accepted",
    payload: {
      taskId: task._id.toString(),
      engineerId: engineer._id.toString(),
      engineerName: engineer.displayName || engineer.name,
      acceptedAt: new Date().toISOString(),
    },
  });
}

/**
 * Existing helper: dispatchEngineerForAlert
 * Used when a PLC-triggered task has been created + assigned.
 */
export async function dispatchEngineerForAlert({
  db,
  alert,
  engineer,
  task,
  reqContext = {},
}) {
  if (!alert || !engineer || !task) {
    throw new Error("dispatchEngineerForAlert requires alert, engineer, and task");
  }

  const runId = await DSSAdapter.startRun(db, {
    initiatedBy: engineer._id?.toString() || null,
    scope: "plcAlert:dispatch",
    meta: {
      alertId: alert._id.toString(),
      engineerId: engineer._id.toString(),
      taskId: task._id.toString(),
      propertyId: alert.propertyId?.toString(),
      assetId: alert.assetId?.toString(),
    },
  });

  await DSSAdapter.recordEvent(db, runId, "plcAlert", "engineerDispatched", {
    severity: "info",
    message: "Engineer dispatched for PLC alert",
    meta: {
      alertId: alert._id.toString(),
      propertyId: alert.propertyId?.toString(),
      assetId: alert.assetId?.toString(),
      engineerId: engineer._id.toString(),
      taskId: task._id.toString(),
    },
    ip: reqContext.ip,
    userAgent: reqContext.userAgent,
    actor: engineer._id?.toString(),
  });

  await DSSAdapter.finishRun(db, runId, { status: "completed" });

  // Update all tabs (client, FM, engineer, admin)
  widgetBus.broadcastWidgetEvent({
    topic: "engineerDispatch",
    action: "dispatched",
    propertyId: alert.propertyId?.toString(),
    assetId: alert.assetId?.toString(),
    alertId: alert._id.toString(),
    taskId: task._id.toString(),
    engineer: {
      id: engineer._id.toString(),
      name: engineer.displayName || engineer.name,
      trade: engineer.primaryTrade,
    },
  });
}

export default {
  offerTicketToEngineers,
  broadcastTicketAccepted,
  dispatchEngineerForAlert,
};

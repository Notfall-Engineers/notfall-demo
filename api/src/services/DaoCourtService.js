import * as widgetBus from "../realtime/widgetBus.js";

/**
 * Called when the Quantum/DAO Judge opens a case
 */
export function notifyDaoCaseOpened({ caseId, workflowId, taskId, reason, evidenceUrl }) {
  widgetBus.broadcastWidgetEvent({
    topic: "daoCourt",
    action: "caseOpened",
    payload: {
      caseId,
      workflowId,
      taskId,
      reason,
      evidenceUrl: evidenceUrl || null,
      openedAt: new Date().toISOString(),
    },
  });
}

/**
 * Called when the DAO Judge issues a verdict on payout / SLA / fraud
 */
export function notifyDaoVerdict({
  caseId,
  verdict,
  workflowId,
  taskId,
  engineerId,
  payoutDelta,
  notes,
}) {
  widgetBus.broadcastWidgetEvent({
    topic: "daoCourt",
    action: "verdict",
    payload: {
      caseId,
      workflowId,
      taskId,
      engineerId,
      verdict, // e.g. "APPROVED", "REDUCED_PAYOUT", "BLOCKED"
      payoutDelta: payoutDelta ?? 0,
      notes: notes || null,
      decidedAt: new Date().toISOString(),
    },
  });
}

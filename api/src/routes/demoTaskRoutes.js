// src/routes/demoTaskRoutes.js
import { Router } from "express";
import {
  // Ticket
  createTicket,
  updateTicket,
  cancelTicket,
  escalateTicket,
  listTickets,

  // Matching
  matchStart,
  matchScored,
  matchOffered,
  matchRejected,
  matchAccepted,
  matchFailed,
  listMatches,

  // Task
  offerTask,
  updateTaskStatus,
  postRams,
  postSla,
  listTasks,

  // Escrow / payments / fee
  escrowDeposit,
  escrowRelease,
  payoutAttempt,
  payoutSucceeded,
  payoutFailed,
  postServiceFee,
  postRefund,

  // DAO
  daoCertSubmit,
  daoCertApprove,
  daoCertReject,
  daoPolicyUpdate,
  listDaoCerts,
  getPolicies,

  // Evidence / compliance
  uploadEvidence,
  generateComplianceReport,
  listEvidence,

  // Audit
  auditLog,
  listAudits,

  // PLC
  createPlcAlert,
  listPlcAlerts
} from "../controllers/demoTaskController.js";

export function buildDemoTaskRoutes() {
  const r = Router();

  // ---- Tickets ----
  r.get("/tickets", listTickets);
  r.post("/tickets", createTicket);
  r.patch("/tickets/:id", updateTicket);
  r.post("/tickets/:id/cancel", cancelTicket);
  r.post("/tickets/:id/escalate", escalateTicket);

  // ---- Tasks ----
  r.get("/tasks", listTasks);
  r.post("/tasks/offer", offerTask);
  r.post("/tasks/:id/status", updateTaskStatus);

  r.post("/tasks/:id/rams", postRams);
  r.post("/tasks/:id/sla", postSla);

  // ---- Matching ----
  r.get("/matches", listMatches);
  r.post("/match/start", matchStart);
  r.post("/match/scored", matchScored);
  r.post("/match/offered", matchOffered);
  r.post("/match/rejected", matchRejected);
  r.post("/match/accepted", matchAccepted);
  r.post("/match/failed", matchFailed);

  // ---- Escrow / payments / fees ----
  r.post("/tasks/:id/escrow/deposit", escrowDeposit);
  r.post("/tasks/:id/escrow/release", escrowRelease);

  r.post("/tasks/:id/payout/attempt", payoutAttempt);
  r.post("/tasks/:id/payout/succeeded", payoutSucceeded);
  r.post("/tasks/:id/payout/failed", payoutFailed);

  r.post("/tasks/:id/service-fee", postServiceFee);
  r.post("/tasks/:id/refund", postRefund);

  // ---- DAO ----
  r.get("/dao/certs", listDaoCerts);
  r.post("/dao/certs", daoCertSubmit);
  r.post("/dao/certs/:id/approve", daoCertApprove);
  r.post("/dao/certs/:id/reject", daoCertReject);

  r.get("/dao/policy", getPolicies);
  r.post("/dao/policy", daoPolicyUpdate);

  // ---- Evidence / compliance ----
  r.get("/evidence", listEvidence);
  r.post("/tasks/:id/evidence", uploadEvidence);
  r.post("/tasks/:id/compliance-report", generateComplianceReport);

  // ---- Audit ----
  r.get("/audits", listAudits);
  r.post("/audits", auditLog);

  // ---- PLC ----
  r.get("/plc/alerts", listPlcAlerts);
  r.post("/plc/alerts", createPlcAlert);

  return r;
}

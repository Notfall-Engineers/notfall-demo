// api/src/services/DSSAdapter.js
/**
 * DSSAdapter.js — aligned to DSSRun, AuditLog, ExecutionLog, EmailLog
 * - newRunId()
 * - applyRequestGuards(req,res,next)
 * - startRun(db, opts)
 * - finishRun(db, runId, opts)
 * - recordEvent(db, runId, scope, action, payload)
 * - dailyExport(db, yyyymmdd)
 * - exportRun(db, runId)
 */

import crypto from "crypto";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Load DSS limits from JSON (Node ESM-safe)
const limits = require("../config/limits.dss.json");

// Pseudonymiser + FCA exporter (namespace + named export)
import * as Pseudo from "../utils/pseudonymiser.js";
import { exportToFCA } from "../utils/fcaExporter.js";

/**
 * Resolve models from the app's `models` bag (set in src/index.js)
 * db is expected to be: { DSSRun, AuditLog, ExecutionLog, EmailLog }
 */
function resolveModels(db) {
  const DSSRun = db.DSSRun;
  const Audit = db.AuditLog;
  const ExecutionLog = db.ExecutionLog;
  const EmailLog = db.EmailLog;

  if (!DSSRun || !Audit || !ExecutionLog || !EmailLog) {
    throw new Error(
      "DSSAdapter.resolveModels: missing one or more DSS models on app.get('models')"
    );
  }

  return { DSSRun, Audit, ExecutionLog, EmailLog };
}

/** ISO day window in UTC */
function dayWindow(yyyymmdd) {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  const start = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  const end = new Date(`${y}-${m}-${d}T23:59:59.999Z`);
  return { start, end };
}

/** Generate a fresh DSS runId */
export function newRunId() {
  return crypto.randomUUID();
}

/**
 * Middleware: ensure a runId is present on req.context for tracing
 * Usage: router.use((req,res,next) => DSSAdapter.applyRequestGuards(req,res,next));
 */
export function applyRequestGuards(req, _res, next) {
  req.context = req.context || {};
  req.context.runId = req.context.runId || newRunId();
  next();
}

/**
 * Start a DSS run (creates DSSRun row with caps snapshot)
 * opts: { initiatedBy, tester, testerEngineer, testerWallet, scope, pseudonym, caps?, meta? }
 */
export async function startRun(db, opts = {}) {
  const { DSSRun } = resolveModels(db);
  const runId = newRunId();

  const caps = opts.caps || {
    perTxGBP: limits.perTxGBP,
    perUserDailyGBP: limits.perUserDailyGBP,
    platformDailyGBP: limits.platformDailyGBP,
  };

  await DSSRun.start({
    runId,
    initiatedBy: opts.initiatedBy || null,
    tester: opts.tester || null,
    testerEngineer: opts.testerEngineer || null,
    testerWallet: opts.testerWallet || null,
    caps,
    scope: opts.scope || "general",
    pseudonym: opts.pseudonym || null,
    meta: opts.meta || {},
  });

  return runId;
}

/**
 * Finish a DSS run and optionally set export batch id or status.
 * opts: { status?, exportBatchId? }
 */
export async function finishRun(db, runId, opts = {}) {
  const { DSSRun } = resolveModels(db);
  const run = await DSSRun.findOne({ runId });
  if (!run) throw new Error("DSSRun not found");
  await run.finish({
    status: opts.status || "completed",
    exportBatchId: opts.exportBatchId || null,
  });
  return true;
}

/**
 * Unified event recorder: writes to both ExecutionLog (operational trail)
 * and AuditLog (governance/compliance trail) using model helpers.
 * payload can contain: { workflowId|taskId, severity, riskScore, pseudonym, meta, txHash, ... }
 */
export async function recordEvent(db, runId, scope, action, payload = {}) {
  const { Audit, ExecutionLog } = resolveModels(db);

  const pseudonym =
    payload.pseudonym ||
    (payload.actor ? Pseudo.id(payload.actor) : null);

  // --- Operational trail (ExecutionLog) ---
  await ExecutionLog.recordDssEvent({
    workflow: payload.workflowId || payload.taskId || payload.workflow || null,
    dssRunId: runId,
    dssScope: scope,
    dssAction: action,
    dssAuditLevel: payload.severity || "info",
    dssRiskScore: payload.riskScore || 0,
    dssPseudonym: pseudonym,
    message: payload.message,
    evidence: payload.evidence,
  });

  // --- Governance/compliance trail (AuditLog or AuditEvent) ---
  await Audit.recordDssAudit({
    runId,
    scope,
    action,
    severity: payload.severity || "info",
    pseudonym,
    meta: payload.meta || payload,
    performedBy: payload.performedBy || null,
    performerWallet: payload.performerWallet || null,
    performerRole: payload.performerRole || "System",
    targets: {
      user: payload.user || null,
      engineer: payload.engineer || null,
      proposal: payload.proposal || null,
      device: payload.device || null,
      badge: payload.badge || null,
    },
    txHash: payload.txHash || null,
    exportStatus: "pending",
    ip: payload.ip,
    userAgent: payload.userAgent,
  });

  return true;
}

/**
 * FCA daily export (UTC day window), combining Audit + Execution + Email logs
 * into one CSV. Returns absolute path to the CSV written.
 */
export async function dailyExport(db, yyyymmdd) {
  const { Audit, ExecutionLog, EmailLog } = resolveModels(db);
  const { start, end } = dayWindow(yyyymmdd);

  const [auditRows, execRows, emailRows] = await Promise.all([
    Audit.find({ createdAt: { $gte: start, $lte: end } }).lean(),
    ExecutionLog.find({ createdAt: { $gte: start, $lte: end } }).lean(),
    EmailLog.find({ createdAt: { $gte: start, $lte: end } }).lean(),
  ]);

  return exportToFCA({ auditRows, execRows, emailRows, meta: { yyyymmdd } });
}

/**
 * Per-run FCA export: export one DSSRun’s Audit + Execution + Email rows.
 */
export async function exportRun(db, runId) {
  const { DSSRun, Audit, ExecutionLog, EmailLog } = resolveModels(db);
  const run = await DSSRun.findOne({ runId }).lean();
  if (!run) throw new Error("DSSRun not found");

  const [auditRows, execRows, emailRows] = await Promise.all([
    Audit.find({ dssRunId: runId }).sort({ createdAt: 1 }).lean(),
    ExecutionLog.find({ dssRunId: runId }).sort({ createdAt: 1 }).lean(),
    EmailLog.find({ "meta.runId": runId }).sort({ createdAt: 1 }).lean(),
  ]);

  return exportToFCA({ auditRows, execRows, emailRows, run });
}

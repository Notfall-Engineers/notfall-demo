// utils/fcaExporter.js
// Minimal FCA-style CSV exporter for DSS runs
// Used by DSSAdapter.dailyExport() and DSSAdapter.exportRun()

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure export directory exists (e.g. /src/exports/dss)
function ensureExportDir() {
  const exportDir = path.resolve(__dirname, "../exports/dss");
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  return exportDir;
}

/**
 * Normalise an object for CSV.
 * Adds a "recordType" and flattens a few known fields so FCA can ingest it
 * (in real life you’d match their exact schema).
 */
function normaliseRow(row = {}, recordType = "audit") {
  const base = {
    recordType,
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : new Date().toISOString(),
    runId: row.dssRunId || row.runId || (row.meta && row.meta.runId) || "",
    severity: row.severity || row.dssAuditLevel || row.level || "",
    scope: row.scope || row.dssScope || "",
    action: row.action || row.dssAction || "",
    message: row.message || "",
    riskScore: row.dssRiskScore || row.riskScore || "",
    txHash: row.txHash || "",
  };

  // Flatten some nested "targets" / meta fields if present
  if (row.targets) {
    base.targetUser = row.targets.user || "";
    base.targetEngineer = row.targets.engineer || "";
    base.targetDevice = row.targets.device || "";
    base.targetProposal = row.targets.proposal || "";
  }

  if (row.meta) {
    base.metaJson = JSON.stringify(row.meta);
  }

  // Emails may store metadata differently
  if (row.email || (row.meta && row.meta.email)) {
    base.email = row.email || row.meta.email;
  }

  return base;
}

/**
 * Convert an array of normalised objects to CSV text.
 */
function toCsv(rows) {
  if (!rows.length) return "";

  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set())
  );

  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = headers.join(",");
  const lines = rows.map((row) =>
    headers.map((h) => escape(row[h])).join(",")
  );

  return [headerLine, ...lines].join("\n");
}

/**
 * Main export function – used by DSSAdapter:
 *
 *   exportToFCA({ auditRows, execRows, emailRows, meta? / run? })
 *
 * Returns the absolute path to the written CSV.
 */
export async function exportToFCA({
  auditRows = [],
  execRows = [],
  emailRows = [],
  meta = {},
  run = null,
} = {}) {
  const exportDir = ensureExportDir();

  const dateTag =
    (meta && meta.yyyymmdd) ||
    (run && run.createdAt && new Date(run.createdAt).toISOString().slice(0, 10).replace(/-/g, "")) ||
    new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const runIdPart = run && run.runId ? `_${run.runId}` : "";
  const fileName = `dss_export_${dateTag}${runIdPart}.csv`;
  const filePath = path.join(exportDir, fileName);

  const normalised = [
    ...auditRows.map((r) => normaliseRow(r, "audit")),
    ...execRows.map((r) => normaliseRow(r, "execution")),
    ...emailRows.map((r) => normaliseRow(r, "email")),
  ];

  const csvBody = toCsv(normalised);

  // Write synchronously – files are small and this is a batch job
  fs.writeFileSync(filePath, csvBody, "utf8");

  return filePath;
}

// Default export (in case anything imports `default` later)
export default {
  exportToFCA,
};

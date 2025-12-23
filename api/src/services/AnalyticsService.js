// src/services/AnalyticsService.js
// BigQuery analytics ingestion with batching + retry/backoff.
// Canonical-event aware: keeps Mermaid + BigQuery consistent.
// Demo-safe: best-effort PII guard + meta redaction.
//
// Requires: @google-cloud/bigquery (only used when enabled)

import { BigQuery } from "@google-cloud/bigquery";

// -------------------------------
// Canonical event names
// Keep in sync with demoTaskController EVENTS.
// -------------------------------
const CANONICAL_EVENTS = new Set([
  // Ticket lifecycle
  "ticket.created",
  "ticket.updated",
  "ticket.cancelled",
  "ticket.escalated",

  // Matching lifecycle
  "match.started",
  "match.scored",
  "match.offered",
  "match.rejected",
  "match.accepted",
  "match.failed",

  // Task lifecycle
  "task.offered",
  "task.accepted",
  "task.declined",
  "task.assigned",
  "task.en_route",
  "task.on_site",
  "task.rams",
  "task.sla",
  "task.completed",
  "task.refund",
  "task.reassigned",
  "task.escalated",

  // Payments / escrow / fees
  "escrow.deposited",
  "escrow.released",
  "payout.attempted",
  "payout.succeeded",
  "payout.failed",
  "task.service_fee",

  // Governance / DAO
  "dao.cert.submitted",
  "dao.cert.approved",
  "dao.cert.rejected",
  "dao.policy.updated",

  // Compliance & evidence
  "evidence.uploaded",
  "compliance.report.generated",
  "audit.logged",

  // PLC
  "plc.alert.created"
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoNow() {
  return new Date().toISOString();
}

function dateFromIso(iso) {
  return (iso || isoNow()).slice(0, 10);
}

function safeNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Best-effort guard against accidental PII in demos.
// NOTE: heuristics only; still avoid collecting PII by design.
function containsLikelyPii(obj) {
  if (!obj) return false;

  let raw = "";
  try {
    raw = JSON.stringify(obj).toLowerCase();
  } catch {
    return false;
  }

  const badMarkers = [
    "@gmail",
    "@yahoo",
    "@hotmail",
    "@outlook",
    "@icloud",
    "phone",
    "mobile",
    "address",
    "postcode",
    "zip",
    "dob",
    "passport",
    "ni number",
    "ssn",
    "iban",
    "sort code",
    "card number"
  ];

  // quick regex checks (emails / long digit strings)
  const emailLike = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(raw);
  const longDigits = /\b\d{10,}\b/.test(raw);

  return emailLike || longDigits || badMarkers.some((m) => raw.includes(m));
}

function redactMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  // do not deep-walk aggressively (costly); just strip obvious keys
  const blockedKeys = new Set([
    "email",
    "phone",
    "mobile",
    "address",
    "postcode",
    "zip",
    "dob",
    "passport",
    "ni",
    "ninumber",
    "ssn",
    "iban",
    "sortcode",
    "cardnumber"
  ]);

  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    const key = String(k || "").toLowerCase().replace(/\s+/g, "");
    if (blockedKeys.has(key)) continue;
    out[k] = v;
  }
  return out;
}

function normaliseEventName(name) {
  if (!name) return null;
  return String(name).trim().toLowerCase();
}

// -----------------------------------------
// BigQuery: optional ensure dataset/table
// -----------------------------------------
async function ensureDatasetAndTable({
  bq,
  datasetId,
  tableId,
  location = "EU"
}) {
  // Minimal schema aligned to your ingestion row below.
  // Keep meta as JSON; BigQuery supports JSON type.
  const schema = [
    { name: "event_id", type: "STRING" },
    { name: "event_ts", type: "TIMESTAMP" },
    { name: "event_date", type: "DATE" },

    { name: "session_id", type: "STRING" },
    { name: "user_pseudo_id", type: "STRING" },

    { name: "role", type: "STRING" },
    { name: "engineer_id", type: "STRING" },
    { name: "client_id", type: "STRING" },
    { name: "page", type: "STRING" },
    { name: "widget_id", type: "STRING" },

    { name: "event_name", type: "STRING" },
    { name: "event_label", type: "STRING" },
    { name: "duration_ms", type: "INT64" },

    // segmentation (demo-safe)
    { name: "country", type: "STRING" },
    { name: "language", type: "STRING" },
    { name: "persona", type: "STRING" },
    { name: "company_size", type: "STRING" },

    // operational ids
    { name: "site_code", type: "STRING" },
    { name: "asset_id", type: "STRING" },
    { name: "plc_alert_id", type: "STRING" },
    { name: "ticket_id", type: "STRING" },
    { name: "workflow_id", type: "STRING" },

    // task domain
    { name: "task_id", type: "STRING" },
    { name: "trade", type: "STRING" },
    { name: "severity", type: "STRING" },

    // matching / SLA
    { name: "match_id", type: "STRING" },
    { name: "match_score", type: "FLOAT64" },
    { name: "rank_position", type: "INT64" },
    { name: "eta_minutes", type: "INT64" },
    { name: "sla_hours", type: "FLOAT64" },
    { name: "sla_state", type: "STRING" },

    // payments
    { name: "amount_gbp", type: "FLOAT64" },
    { name: "fee_gbp", type: "FLOAT64" },
    { name: "provider", type: "STRING" },
    { name: "currency", type: "STRING" },

    // flexible
    { name: "meta", type: "JSON" }
  ];

  const dataset = bq.dataset(datasetId);

  const [dsExists] = await dataset.exists();
  if (!dsExists) {
    await dataset.create({ location });
  }

  const table = dataset.table(tableId);
  const [tblExists] = await table.exists();
  if (!tblExists) {
    await table.create({
      schema,
      timePartitioning: { type: "DAY", field: "event_date" },
      clustering: { fields: ["event_name", "role", "task_id"] }
    });
  }
}

// -----------------------------------------
// AnalyticsService
// -----------------------------------------
export class AnalyticsService {
  constructor({
    projectId,
    datasetId = "notfall_demo_analytics",
    tableId = "events",
    enabled = false,

    // batching
    batchSize = 50,
    flushMs = 2000,

    // retry/backoff
    maxAttempts = 5,
    maxBackoffMs = 5000,

    // safety / strictness
    strictCanonical = true, // drop non-canonical event_name
    demoSafe = true, // apply PII heuristics + meta redaction

    // DX helpers
    ensureTable = false, // auto-create dataset/table if missing
    bqLocation = "EU",

    // when disabled, optionally log to console to prove analytics is “working”
    consoleSinkWhenDisabled = false
  } = {}) {
    this.projectId = projectId;
    this.datasetId = datasetId;
    this.tableId = tableId;

    this.enabled = Boolean(enabled && projectId);
    this.batchSize = Number(batchSize) || 50;
    this.flushMs = Number(flushMs) || 2000;

    this.maxAttempts = Number(maxAttempts) || 5;
    this.maxBackoffMs = Number(maxBackoffMs) || 5000;

    this.strictCanonical = Boolean(strictCanonical);
    this.demoSafe = Boolean(demoSafe);

    this.ensureTable = Boolean(ensureTable);
    this.bqLocation = bqLocation;

    this.consoleSinkWhenDisabled = Boolean(consoleSinkWhenDisabled);

    this.queue = [];
    this.deadLetter = []; // best-effort buffer for repeated failures
    this.timer = null;
    this.flushing = false;
    this.started = false;

    this.bq = this.enabled ? new BigQuery({ projectId }) : null;

    this._ensured = false;
  }

  async start() {
    if (this.started) return;
    this.started = true;

    if (!this.enabled) return;

    if (this.ensureTable && !this._ensured) {
      try {
        await ensureDatasetAndTable({
          bq: this.bq,
          datasetId: this.datasetId,
          tableId: this.tableId,
          location: this.bqLocation
        });
        this._ensured = true;
      } catch (e) {
        console.warn("Analytics ensure table failed:", e?.message || e);
      }
    }

    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch(() => {});
    }, this.flushMs);
  }

  async stop({ flush = false } = {}) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;

    if (flush) {
      try {
        await this.drain({ timeoutMs: 8000 });
      } catch {
        // ignore
      }
    }
  }

  async drain({ timeoutMs = 8000 } = {}) {
    if (!this.enabled) return;
    const start = Date.now();
    while (this.queue.length) {
      await this.flush().catch(() => {});
      if (Date.now() - start > timeoutMs) break;
      await sleep(150);
    }
  }

  enqueue(event) {
    if (!event) return;

    // When disabled: optionally log for demo confidence
    if (!this.enabled) {
      if (this.consoleSinkWhenDisabled) {
        const name = normaliseEventName(event.event_name);
        if (!name) return;
        console.log("[analytics:disabled]", name, {
          role: event.role,
          widget_id: event.widget_id,
          task_id: event.task_id,
          ticket_id: event.ticket_id
        });
      }
      return;
    }

    const event_name = normaliseEventName(event.event_name);
    if (!event_name) return;

    if (this.strictCanonical && !CANONICAL_EVENTS.has(event_name)) {
      return;
    }

    if (this.demoSafe) {
      if (containsLikelyPii(event.meta)) return;
    }

    const ts = event.event_ts || isoNow();
    const metaSafe = this.demoSafe ? redactMeta(event.meta) : (event.meta || {});

    const row = {
      event_id: event.event_id || null,
      event_ts: ts,
      event_date: event.event_date || dateFromIso(ts),

      session_id: event.session_id || null,
      user_pseudo_id: event.user_pseudo_id || null,

      role: event.role || null,
      engineer_id: event.engineer_id || null,
      client_id: event.client_id || null,
      page: event.page || null,
      widget_id: event.widget_id || null,

      event_name,
      event_label: event.event_label || null,
      duration_ms: Number.isFinite(Number(event.duration_ms))
        ? Number(event.duration_ms)
        : null,

      country: event.country || null,
      language: event.language || null,
      persona: event.persona || null,
      company_size: event.company_size || null,

      site_code: event.site_code || null,
      asset_id: event.asset_id || null,
      plc_alert_id: event.plc_alert_id || null,
      ticket_id: event.ticket_id || null,
      workflow_id: event.workflow_id || null,

      task_id: event.task_id || null,
      trade: event.trade || null,
      severity: event.severity || null,

      match_id: event.match_id || null,
      match_score: safeNumber(event.match_score),
      rank_position: Number.isFinite(Number(event.rank_position))
        ? Number(event.rank_position)
        : null,
      eta_minutes: Number.isFinite(Number(event.eta_minutes))
        ? Number(event.eta_minutes)
        : null,
      sla_hours: safeNumber(event.sla_hours),
      sla_state: event.sla_state || null,

      amount_gbp: safeNumber(event.amount_gbp ?? event.amountGbp),
      fee_gbp: safeNumber(event.fee_gbp ?? event.feeGbp),
      provider: event.provider || null,
      currency: event.currency || null,

      meta: metaSafe || {}
    };

    this.queue.push(row);

    if (this.queue.length >= this.batchSize) {
      this.flush().catch(() => {});
    }
  }

  async flush() {
    if (!this.enabled) return;
    if (this.flushing) return;
    if (!this.queue.length) return;

    this.flushing = true;

    const batch = this.queue.splice(0, this.batchSize);
    const dataset = this.bq.dataset(this.datasetId);
    const table = dataset.table(this.tableId);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        await table.insert(batch, { raw: true });
        this.flushing = false;
        return;
      } catch (err) {
        const lastAttempt = attempt === this.maxAttempts;

        if (!this._ensured && this.ensureTable) {
          try {
            await ensureDatasetAndTable({
              bq: this.bq,
              datasetId: this.datasetId,
              tableId: this.tableId,
              location: this.bqLocation
            });
            this._ensured = true;
          } catch {
            // ignore
          }
        }

        if (lastAttempt) {
          this.queue.unshift(...batch);

          const maxDLQ = 500;
          this.deadLetter.push({
            ts: isoNow(),
            error: err?.message || String(err),
            count: batch.length
          });
          if (this.deadLetter.length > maxDLQ) {
            this.deadLetter.splice(0, this.deadLetter.length - maxDLQ);
          }

          this.flushing = false;
          throw err;
        }

        const backoff = Math.min(this.maxBackoffMs, 250 * Math.pow(2, attempt));
        await sleep(backoff);
      }
    }

    this.flushing = false;
  }

  getHealth() {
    return {
      enabled: this.enabled,
      projectId: this.projectId || null,
      datasetId: this.datasetId,
      tableId: this.tableId,
      queueDepth: this.queue.length,
      flushing: this.flushing,
      deadLetterDepth: this.deadLetter.length
    };
  }
}

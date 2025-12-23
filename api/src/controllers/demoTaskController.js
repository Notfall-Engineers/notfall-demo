// src/controllers/demoTaskController.js
// Canonical demo controller covering ALL event families.
// In-memory store for demo; swap with Mongo models when ready.

export const EVENTS = {
  // Ticket lifecycle
  TICKET_CREATED: "ticket.created",
  TICKET_UPDATED: "ticket.updated",
  TICKET_CANCELLED: "ticket.cancelled",
  TICKET_ESCALATED: "ticket.escalated",

  // Matching lifecycle
  MATCH_STARTED: "match.started",
  MATCH_SCORED: "match.scored", // includes top-N + explanation
  MATCH_OFFERED: "match.offered", // offer to engineer
  MATCH_REJECTED: "match.rejected",
  MATCH_ACCEPTED: "match.accepted",
  MATCH_FAILED: "match.failed",

  // Task lifecycle
  TASK_OFFERED: "task.offered",
  TASK_ACCEPTED: "task.accepted",
  TASK_DECLINED: "task.declined",
  TASK_ASSIGNED: "task.assigned",
  TASK_EN_ROUTE: "task.en_route",
  TASK_ON_SITE: "task.on_site",
  TASK_RAMS: "task.rams",
  TASK_SLA: "task.sla", // breach_risk | breached | cleared
  TASK_COMPLETED: "task.completed",
  TASK_REFUND: "task.refund",
  TASK_REASSIGNED: "task.reassigned",
  TASK_ESCALATED: "task.escalated",

  // Payments / escrow / fees
  ESCROW_DEPOSITED: "escrow.deposited",
  ESCROW_RELEASED: "escrow.released",
  PAYOUT_ATTEMPTED: "payout.attempted",
  PAYOUT_SUCCEEDED: "payout.succeeded",
  PAYOUT_FAILED: "payout.failed",
  TASK_SERVICE_FEE: "task.service_fee",

  // Governance / DAO
  DAO_CERT_SUBMITTED: "dao.cert.submitted",
  DAO_CERT_APPROVED: "dao.cert.approved",
  DAO_CERT_REJECTED: "dao.cert.rejected",
  DAO_POLICY_UPDATED: "dao.policy.updated",

  // Compliance & evidence
  EVIDENCE_UPLOADED: "evidence.uploaded",
  COMPLIANCE_REPORT_GENERATED: "compliance.report.generated",
  AUDIT_LOGGED: "audit.logged",

  // PLC
  PLC_ALERT_CREATED: "plc.alert.created"
};

// -------------------------------------------------------------------
// Demo store
// -------------------------------------------------------------------
const DB = {
  tickets: [],
  tasks: [],
  matches: [],
  daoCerts: [],
  plcAlerts: [],
  evidence: [],
  audits: [],
  policies: {
    platformFeePct: 5,
    underwritingBufferGbp: 200,
    slaRules: { defaultHours: 2, breachRiskMins: 20 }
  }
};

// -------------------------------------------------------------------
// Utils
// -------------------------------------------------------------------
function id(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function isoNow() {
  return new Date().toISOString();
}

function today() {
  return isoNow().slice(0, 10);
}

function publishWs(app, msg) {
  const hub = app?.locals?.widgetHub;
  if (hub?.publish) hub.publish(msg);
}

function track(app, ev) {
  const analytics = app?.locals?.analytics;
  if (analytics?.enqueue) analytics.enqueue(ev);
}

/**
 * Unified emitter:
 * - publishes to dashboards via WS
 * - tracks to analytics via BigQuery queue
 *
 * Keep event_name canonical. Topic/action are for WS semantics.
 */
function emit(req, {
  event_name,
  topic,
  action,
  payload = {},
  recipients = { roles: ["ENGINEER", "CLIENT", "DAO_ADMIN"] },
  analytics = {}
}) {
  // 1) WS publish
  publishWs(req.app, {
    topic,
    action,
    payload,
    recipients,
    ts: isoNow()
  });

  // 2) BigQuery analytics
  track(req.app, {
    event_id: id("evt"),
    event_ts: isoNow(),
    event_date: today(),
    event_name,

    role: analytics.role || "SYSTEM",
    page: analytics.page || "backend",
    widget_id: analytics.widget_id || `${topic}_${action}`,
    session_id: analytics.session_id || analytics.session || undefined,

    ticket_id: payload.ticket_id || payload.ticketId || analytics.ticket_id,
    task_id: payload.task_id || payload.taskId || analytics.task_id,
    engineer_id: payload.engineer_id || payload.engineerId || analytics.engineer_id,
    client_id: payload.client_id || payload.clientId || analytics.client_id,

    trade: payload.trade || analytics.trade,
    severity: payload.severity || payload.priority || analytics.severity,

    match_id: payload.match_id || analytics.match_id,
    match_score: payload.match_score || analytics.match_score,
    rank_position: payload.rank_position || analytics.rank_position,
    eta_minutes: payload.eta_minutes || analytics.eta_minutes,
    sla_hours: payload.sla_hours || analytics.sla_hours,
    sla_state: payload.sla_state || analytics.sla_state,

    amount_gbp: payload.amount_gbp || analytics.amount_gbp,
    fee_gbp: payload.fee_gbp || analytics.fee_gbp,
    provider: payload.provider || analytics.provider,
    currency: payload.currency || analytics.currency,

    meta: {
      ...(analytics.meta || {}),
      payload
    }
  });
}

function findTask(taskId) {
  return DB.tasks.find((t) => t.id === taskId);
}

function findTicket(ticketId) {
  return DB.tickets.find((t) => t.id === ticketId);
}

// -------------------------------------------------------------------
// TICKET LIFECYCLE
// -------------------------------------------------------------------

export async function createTicket(req, res) {
  const body = req.body || {};
  const ticket = {
    id: id("tkt"),
    createdAt: isoNow(),
    updatedAt: isoNow(),
    site: body.site || "Level39 — 1 Canada Square",
    trade: body.trade || "HVAC",
    severity: (body.severity || "HIGH").toUpperCase(),
    summary: body.summary || "Emergency fault",
    status: "CREATED",
    notes: []
  };

  DB.tickets.unshift(ticket);

  emit(req, {
    event_name: EVENTS.TICKET_CREATED,
    topic: "ticket",
    action: "created",
    payload: {
      ticket_id: ticket.id,
      trade: ticket.trade,
      severity: ticket.severity,
      site: ticket.site,
      summary: ticket.summary,
      status: ticket.status
    },
    recipients: { roles: ["CLIENT", "ENGINEER", "DAO_ADMIN"] },
    analytics: { role: "CLIENT", page: "client_portal", widget_id: "ticket_create" }
  });

  res.json({ ok: true, ticket });
}

export async function updateTicket(req, res) {
  const { id: ticketId } = req.params;
  const body = req.body || {};
  const t = findTicket(ticketId);
  if (!t) return res.status(404).json({ ok: false, error: "Ticket not found" });

  if (body.summary != null) t.summary = String(body.summary);
  if (body.severity != null) t.severity = String(body.severity).toUpperCase();
  if (body.trade != null) t.trade = String(body.trade);
  if (body.site != null) t.site = String(body.site);
  if (body.note) t.notes.unshift({ at: isoNow(), note: String(body.note) });

  t.updatedAt = isoNow();
  t.status = body.status ? String(body.status).toUpperCase() : t.status;

  emit(req, {
    event_name: EVENTS.TICKET_UPDATED,
    topic: "ticket",
    action: "updated",
    payload: {
      ticket_id: t.id,
      trade: t.trade,
      severity: t.severity,
      site: t.site,
      summary: t.summary,
      status: t.status
    },
    recipients: { roles: ["CLIENT", "DAO_ADMIN"] },
    analytics: { role: "CLIENT", page: "client_portal", widget_id: "ticket_update" }
  });

  res.json({ ok: true, ticket: t });
}

export async function cancelTicket(req, res) {
  const { id: ticketId } = req.params;
  const t = findTicket(ticketId);
  if (!t) return res.status(404).json({ ok: false, error: "Ticket not found" });

  t.status = "CANCELLED";
  t.updatedAt = isoNow();

  emit(req, {
    event_name: EVENTS.TICKET_CANCELLED,
    topic: "ticket",
    action: "cancelled",
    payload: { ticket_id: t.id, status: t.status },
    recipients: { roles: ["CLIENT", "DAO_ADMIN"] },
    analytics: { role: "CLIENT", page: "client_portal", widget_id: "ticket_cancel" }
  });

  res.json({ ok: true, ticket: t });
}

export async function escalateTicket(req, res) {
  const { id: ticketId } = req.params;
  const body = req.body || {};
  const t = findTicket(ticketId);
  if (!t) return res.status(404).json({ ok: false, error: "Ticket not found" });

  t.status = "ESCALATED";
  t.updatedAt = isoNow();
  const reason = body.reason || "Client escalated";

  emit(req, {
    event_name: EVENTS.TICKET_ESCALATED,
    topic: "ticket",
    action: "escalated",
    payload: { ticket_id: t.id, reason, status: t.status },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "CLIENT", page: "client_portal", widget_id: "ticket_escalate", meta: { reason } }
  });

  res.json({ ok: true, ticket: t });
}

// -------------------------------------------------------------------
// MATCHING LIFECYCLE
// -------------------------------------------------------------------

export async function matchStart(req, res) {
  const { taskId } = req.body || {};
  const task = taskId ? findTask(taskId) : null;
  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  const match = {
    id: id("match"),
    taskId: task.id,
    createdAt: isoNow(),
    status: "STARTED",
    topN: []
  };
  DB.matches.unshift(match);

  emit(req, {
    event_name: EVENTS.MATCH_STARTED,
    topic: "match",
    action: "started",
    payload: { match_id: match.id, task_id: task.id, trade: task.trade },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "match_started" }
  });

  res.json({ ok: true, match });
}

export async function matchScored(req, res) {
  const body = req.body || {};
  const { matchId, taskId } = body;
  const match = DB.matches.find((m) => m.id === matchId) || null;
  const task = taskId ? findTask(taskId) : match ? findTask(match.taskId) : null;
  if (!match || !task) return res.status(404).json({ ok: false, error: "Match/Task not found" });

  const top_engineers = Array.isArray(body.top_engineers) ? body.top_engineers : [];
  const explanation =
    body.explanation || "Score = distance + ETA + SLA risk + reputation + availability";

  match.status = "SCORED";
  match.topN = top_engineers.slice(0, 10);

  emit(req, {
    event_name: EVENTS.MATCH_SCORED,
    topic: "match",
    action: "scored",
    payload: {
      match_id: match.id,
      task_id: task.id,
      trade: task.trade,
      top_engineers: match.topN.slice(0, 5),
      explanation
    },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "match_scored", meta: { explanation } }
  });

  res.json({ ok: true, match });
}

export async function matchOffered(req, res) {
  const body = req.body || {};
  const match = DB.matches.find((m) => m.id === body.matchId);
  if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

  const task = findTask(match.taskId);
  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  const engineer_id = body.engineer_id || (match.topN?.[0]?.engineer_id ?? "eng_demo_001");
  match.status = "OFFERED";
  match.offeredTo = engineer_id;
  match.offeredAt = isoNow();

  emit(req, {
    event_name: EVENTS.MATCH_OFFERED,
    topic: "match",
    action: "offered",
    payload: { match_id: match.id, task_id: task.id, engineer_id },
    recipients: { roles: ["ENGINEER"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "match_offered" }
  });

  // Canonical task event that UI expects
  emit(req, {
    event_name: EVENTS.TASK_OFFERED,
    topic: "task",
    action: "offered",
    payload: { task_id: task.id, trade: task.trade, priority: task.priority, engineer_id },
    recipients: { roles: ["ENGINEER"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "task_offered" }
  });

  res.json({ ok: true, match, task });
}

export async function matchRejected(req, res) {
  const { matchId, engineer_id, reason } = req.body || {};
  const match = DB.matches.find((m) => m.id === matchId);
  if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

  match.status = "REJECTED";
  match.rejectedBy = engineer_id || match.offeredTo || "eng_demo_001";
  match.rejectedAt = isoNow();
  match.rejectReason = reason || "Engineer unavailable";

  emit(req, {
    event_name: EVENTS.MATCH_REJECTED,
    topic: "match",
    action: "rejected",
    payload: {
      match_id: match.id,
      task_id: match.taskId,
      engineer_id: match.rejectedBy,
      reason: match.rejectReason
    },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "match_reject" }
  });

  emit(req, {
    event_name: EVENTS.TASK_DECLINED,
    topic: "task",
    action: "declined",
    payload: {
      task_id: match.taskId,
      engineer_id: match.rejectedBy,
      reason: match.rejectReason
    },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "task_decline" }
  });

  res.json({ ok: true, match });
}

export async function matchAccepted(req, res) {
  const { matchId, engineer_id } = req.body || {};
  const match = DB.matches.find((m) => m.id === matchId);
  if (!match) return res.status(404).json({ ok: false, error: "Match not found" });

  const task = findTask(match.taskId);
  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  match.status = "ACCEPTED";
  match.acceptedBy = engineer_id || match.offeredTo || "eng_demo_001";
  match.acceptedAt = isoNow();

  task.status = "ACCEPTED";
  task.acceptedAt = Date.now();
  task.engineerId = match.acceptedBy;

  emit(req, {
    event_name: EVENTS.MATCH_ACCEPTED,
    topic: "match",
    action: "accepted",
    payload: { match_id: match.id, task_id: task.id, engineer_id: match.acceptedBy },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "match_accept" }
  });

  emit(req, {
    event_name: EVENTS.TASK_ACCEPTED,
    topic: "task",
    action: "accepted",
    payload: { task_id: task.id, engineer_id: task.engineerId },
    recipients: { roles: ["CLIENT", "DAO_ADMIN"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "task_accept" }
  });

  // In many flows, accept implies assigned
  task.status = "ASSIGNED";

  emit(req, {
    event_name: EVENTS.TASK_ASSIGNED,
    topic: "task",
    action: "assigned",
    payload: { task_id: task.id, engineer_id: task.engineerId },
    recipients: { roles: ["CLIENT", "DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "dispatch_assigned" }
  });

  res.json({ ok: true, match, task });
}

export async function matchFailed(req, res) {
  const { taskId, reason } = req.body || {};
  const task = taskId ? findTask(taskId) : null;
  if (!task) return res.status(404).json({ ok: false, error: "Task not found" });

  const match = {
    id: id("match"),
    taskId: task.id,
    createdAt: isoNow(),
    status: "FAILED",
    reason: reason || "No engineers available"
  };
  DB.matches.unshift(match);

  emit(req, {
    event_name: EVENTS.MATCH_FAILED,
    topic: "match",
    action: "failed",
    payload: { match_id: match.id, task_id: task.id, reason: match.reason },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "match_failed", meta: { reason: match.reason } }
  });

  res.json({ ok: true, match });
}

// -------------------------------------------------------------------
// TASK LIFECYCLE (offer creation + status progression)
// -------------------------------------------------------------------

export async function offerTask(req, res) {
  const body = req.body || {};
  const task = {
    id: id("task"),
    createdAt: isoNow(),
    title: body.title || "Dispatch: investigate fault",
    site: body.site || "Level39 — 1 Canada Square",
    trade: body.trade || "HVAC",
    priority: (body.priority || "HIGH").toUpperCase(),

    status: "NEW",
    live: true,

    acceptedAt: null,
    enRouteAt: null,
    onSiteAt: null,
    completedAt: null,

    slaHours: Number(body.slaHours || DB.policies.slaRules.defaultHours || 2),
    slaDeadline:
      Date.now() +
      Number(body.slaHours || DB.policies.slaRules.defaultHours || 2) * 3600000,

    jobWallet: {
      provider: "Revolut",
      amount: Number(body.escrowAmountGbp || 200),
      currency: "GBP",
      etaMinutes: Number(body.etaMinutes || 30),
      rate: Number(body.rate || 65)
    },

    engineerId: null,
    clientId: body.clientId || "client_demo_001",
    rams: null
  };

  DB.tasks.unshift(task);

  emit(req, {
    event_name: EVENTS.TASK_OFFERED,
    topic: "task",
    action: "offered",
    payload: {
      task_id: task.id,
      trade: task.trade,
      priority: task.priority,
      site: task.site,
      amount_gbp: task.jobWallet.amount,
      currency: task.jobWallet.currency,
      eta_minutes: task.jobWallet.etaMinutes,
      sla_hours: task.slaHours,
      provider: task.jobWallet.provider
    },
    recipients: { roles: ["ENGINEER", "DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "task_offer" }
  });

  res.json({ ok: true, task });
}

export async function updateTaskStatus(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const next = String(body.status || "").toUpperCase();
  const engineer_id = body.engineer_id || body.engineerId || t.engineerId || "eng_demo_001";

  t.status = next;
  if (!t.engineerId && engineer_id) t.engineerId = engineer_id;

  const now = Date.now();
  if (next === "ACCEPTED") t.acceptedAt = now;
  if (next === "ASSIGNED") t.acceptedAt = t.acceptedAt || now;
  if (next === "EN_ROUTE") t.enRouteAt = now;
  if (next === "ON_SITE") t.onSiteAt = now;
  if (next === "COMPLETED") t.completedAt = now;

  const map = {
    ACCEPTED: EVENTS.TASK_ACCEPTED,
    DECLINED: EVENTS.TASK_DECLINED,
    ASSIGNED: EVENTS.TASK_ASSIGNED,
    EN_ROUTE: EVENTS.TASK_EN_ROUTE,
    ON_SITE: EVENTS.TASK_ON_SITE,
    COMPLETED: EVENTS.TASK_COMPLETED,
    ESCALATED: EVENTS.TASK_ESCALATED,
    REASSIGNED: EVENTS.TASK_REASSIGNED
  };

  const event_name = map[next] || EVENTS.TICKET_UPDATED; // fallback (should be rare)

  emit(req, {
    event_name,
    topic: "task",
    action: next.toLowerCase(),
    payload: {
      task_id: t.id,
      engineer_id: t.engineerId,
      trade: t.trade,
      priority: t.priority,
      status: next
    },
    recipients: { roles: ["ENGINEER", "CLIENT", "DAO_ADMIN"] },
    analytics: { role: next === "DECLINED" ? "ENGINEER" : "SYSTEM", page: "backend", widget_id: "task_status" }
  });

  res.json({ ok: true, task: t });
}

// -------------------------------------------------------------------
// RAMS + SLA
// -------------------------------------------------------------------

export async function postRams(req, res) {
  const { id: taskId } = req.params;
  const payload = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  t.rams = payload;

  emit(req, {
    event_name: EVENTS.TASK_RAMS,
    topic: "task",
    action: "rams",
    payload: { task_id: t.id, engineer_id: t.engineerId, rams: payload },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "rams_submit" }
  });

  res.json({ ok: true });
}

export async function postSla(req, res) {
  const { id: taskId } = req.params;
  const { sla_state, note } = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const state = String(sla_state || "breach_risk").toLowerCase();

  emit(req, {
    event_name: EVENTS.TASK_SLA,
    topic: "task",
    action: "sla",
    payload: { task_id: t.id, sla_state: state, sla_deadline: t.slaDeadline, note },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "sla_event", meta: { note } }
  });

  if (state === "breached") {
    t.status = "ESCALATED";
    emit(req, {
      event_name: EVENTS.TASK_ESCALATED,
      topic: "task",
      action: "escalated",
      payload: { task_id: t.id, reason: "SLA breached" },
      recipients: { roles: ["DAO_ADMIN"] },
      analytics: { role: "SYSTEM", page: "backend", widget_id: "sla_escalate" }
    });
  }

  res.json({ ok: true });
}

// -------------------------------------------------------------------
// ESCROW / PAYMENTS / FEES
// -------------------------------------------------------------------

export async function escrowDeposit(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? t.jobWallet?.amount ?? 200);
  const provider = body.provider || "Revolut";

  t.escrow = { status: "DEPOSITED", amount_gbp, provider, depositedAt: isoNow() };

  emit(req, {
    event_name: EVENTS.ESCROW_DEPOSITED,
    topic: "escrow",
    action: "deposited",
    payload: { task_id: t.id, amount_gbp, provider, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "CLIENT", page: "client_portal", widget_id: "escrow_deposit" }
  });

  res.json({ ok: true, escrow: t.escrow });
}

export async function escrowRelease(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? t.escrow?.amount_gbp ?? 0);
  const provider = body.provider || t.escrow?.provider || "Revolut";
  const reason = body.reason || "Work approved";

  t.escrow = { ...(t.escrow || {}), status: "RELEASED", releasedAt: isoNow() };

  emit(req, {
    event_name: EVENTS.ESCROW_RELEASED,
    topic: "escrow",
    action: "released",
    payload: { task_id: t.id, amount_gbp, provider, reason, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN", "ENGINEER", "CLIENT"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "escrow_release", meta: { reason } }
  });

  res.json({ ok: true, escrow: t.escrow });
}

export async function payoutAttempt(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? 0);
  const provider = body.provider || "Revolut";
  const payout_id = id("pyt");

  emit(req, {
    event_name: EVENTS.PAYOUT_ATTEMPTED,
    topic: "payout",
    action: "attempted",
    payload: { task_id: t.id, payout_id, amount_gbp, provider, engineer_id: t.engineerId, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN", "ENGINEER"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "payout_attempt" }
  });

  res.json({ ok: true, payout_id });
}

export async function payoutSucceeded(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const payout_id = body.payout_id || id("pyt");
  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? 0);
  const provider = body.provider || "Revolut";

  emit(req, {
    event_name: EVENTS.PAYOUT_SUCCEEDED,
    topic: "payout",
    action: "succeeded",
    payload: { task_id: t.id, payout_id, amount_gbp, provider, engineer_id: t.engineerId, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN", "ENGINEER"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "payout_success" }
  });

  res.json({ ok: true });
}

export async function payoutFailed(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const payout_id = body.payout_id || id("pyt");
  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? 0);
  const provider = body.provider || "Revolut";
  const reason = body.reason || "Provider error";

  emit(req, {
    event_name: EVENTS.PAYOUT_FAILED,
    topic: "payout",
    action: "failed",
    payload: { task_id: t.id, payout_id, amount_gbp, provider, reason, engineer_id: t.engineerId, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "payout_failed", meta: { reason } }
  });

  res.json({ ok: true });
}

export async function postServiceFee(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const fee_gbp = Number(body.fee_gbp ?? body.feeGbp ?? 0);
  const pct = Number(body.pct ?? body.platformFeePct ?? DB.policies.platformFeePct);

  emit(req, {
    event_name: EVENTS.TASK_SERVICE_FEE,
    topic: "task",
    action: "service_fee",
    payload: { task_id: t.id, fee_gbp, platform_fee_pct: pct, currency: "GBP" },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "service_fee" }
  });

  res.json({ ok: true });
}

// -------------------------------------------------------------------
// REFUND
// -------------------------------------------------------------------
export async function postRefund(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const amount_gbp = Number(body.amount_gbp ?? body.amountGbp ?? 0);
  const reason = body.reason || "Adjustment";

  emit(req, {
    event_name: EVENTS.TASK_REFUND,
    topic: "task",
    action: "refund",
    payload: { task_id: t.id, amount_gbp, reason, currency: "GBP" },
    recipients: { roles: ["CLIENT", "DAO_ADMIN"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "refund", meta: { reason } }
  });

  res.json({ ok: true });
}

// -------------------------------------------------------------------
// GOVERNANCE / DAO
// -------------------------------------------------------------------

export async function daoCertSubmit(req, res) {
  const body = req.body || {};
  const cert = {
    id: id("cert"),
    engineer_id: body.engineer_id || "eng_demo_001",
    submittedAt: isoNow(),
    status: "SUBMITTED",
    note: body.note || ""
  };
  DB.daoCerts.unshift(cert);

  emit(req, {
    event_name: EVENTS.DAO_CERT_SUBMITTED,
    topic: "dao",
    action: "cert_submitted",
    payload: { cert_id: cert.id, engineer_id: cert.engineer_id, note: cert.note },
    recipients: { roles: ["DAO_ADMIN", "ENGINEER"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "dao_cert_submit" }
  });

  res.json({ ok: true, cert });
}

export async function daoCertApprove(req, res) {
  const { id: certId } = req.params;
  const cert = DB.daoCerts.find((c) => c.id === certId);
  if (!cert) return res.status(404).json({ ok: false, error: "Cert not found" });

  cert.status = "APPROVED";
  cert.reviewedAt = isoNow();

  emit(req, {
    event_name: EVENTS.DAO_CERT_APPROVED,
    topic: "dao",
    action: "cert_approved",
    payload: { cert_id: cert.id, engineer_id: cert.engineer_id },
    recipients: { roles: ["ENGINEER", "DAO_ADMIN"] },
    analytics: { role: "DAO_ADMIN", page: "dao_console", widget_id: "dao_cert_approve" }
  });

  res.json({ ok: true, cert });
}

export async function daoCertReject(req, res) {
  const { id: certId } = req.params;
  const body = req.body || {};
  const cert = DB.daoCerts.find((c) => c.id === certId);
  if (!cert) return res.status(404).json({ ok: false, error: "Cert not found" });

  cert.status = "REJECTED";
  cert.reviewedAt = isoNow();
  cert.note = body.note || cert.note || "Insufficient documentation";

  emit(req, {
    event_name: EVENTS.DAO_CERT_REJECTED,
    topic: "dao",
    action: "cert_rejected",
    payload: { cert_id: cert.id, engineer_id: cert.engineer_id, note: cert.note },
    recipients: { roles: ["ENGINEER", "DAO_ADMIN"] },
    analytics: { role: "DAO_ADMIN", page: "dao_console", widget_id: "dao_cert_reject", meta: { note: cert.note } }
  });

  res.json({ ok: true, cert });
}

export async function daoPolicyUpdate(req, res) {
  const body = req.body || {};
  DB.policies = {
    ...DB.policies,
    ...body,
    slaRules: { ...(DB.policies.slaRules || {}), ...(body.slaRules || {}) }
  };

  emit(req, {
    event_name: EVENTS.DAO_POLICY_UPDATED,
    topic: "dao",
    action: "policy_updated",
    payload: { policy: DB.policies },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: "DAO_ADMIN", page: "dao_console", widget_id: "dao_policy_update" }
  });

  res.json({ ok: true, policy: DB.policies });
}

// -------------------------------------------------------------------
// COMPLIANCE & EVIDENCE
// -------------------------------------------------------------------

export async function uploadEvidence(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const item = {
    id: id("evd"),
    taskId: t.id,
    file_name: body.file_name || body.fileName || "photo.jpg",
    file_type: body.file_type || body.fileType || "image/jpeg",
    note: body.note || "",
    uploadedAt: isoNow()
  };

  DB.evidence.unshift(item);

  emit(req, {
    event_name: EVENTS.EVIDENCE_UPLOADED,
    topic: "compliance",
    action: "evidence_uploaded",
    payload: {
      task_id: t.id,
      evidence_id: item.id,
      file_name: item.file_name,
      file_type: item.file_type,
      note: item.note
    },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "ENGINEER", page: "engineer_dashboard", widget_id: "evidence_upload" }
  });

  res.json({ ok: true, evidence: item });
}

export async function generateComplianceReport(req, res) {
  const { id: taskId } = req.params;
  const body = req.body || {};
  const t = findTask(taskId);
  if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

  const report = {
    id: id("rep"),
    taskId: t.id,
    generatedAt: isoNow(),
    format: body.format || "PDF",
    summary: body.summary || "RAMS + evidence compiled",
    evidenceCount: DB.evidence.filter((e) => e.taskId === t.id).length
  };

  emit(req, {
    event_name: EVENTS.COMPLIANCE_REPORT_GENERATED,
    topic: "compliance",
    action: "report_generated",
    payload: {
      task_id: t.id,
      report_id: report.id,
      format: report.format,
      evidence_count: report.evidenceCount,
      summary: report.summary
    },
    recipients: { roles: ["DAO_ADMIN", "CLIENT"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "compliance_report" }
  });

  res.json({ ok: true, report });
}

// -------------------------------------------------------------------
// AUDIT LOGGING
// -------------------------------------------------------------------

export async function auditLog(req, res) {
  const body = req.body || {};
  const entry = {
    id: id("aud"),
    createdAt: isoNow(),
    actor_role: body.actor_role || "SYSTEM",
    action: body.action || "unknown",
    entity: body.entity || "system",
    entity_id: body.entity_id || null,
    note: body.note || "",
    meta: body.meta || {}
  };

  DB.audits.unshift(entry);

  emit(req, {
    event_name: EVENTS.AUDIT_LOGGED,
    topic: "audit",
    action: "logged",
    payload: {
      audit_id: entry.id,
      actor_role: entry.actor_role,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entity_id,
      note: entry.note
    },
    recipients: { roles: ["DAO_ADMIN"] },
    analytics: { role: entry.actor_role, page: "backend", widget_id: "audit_log", meta: entry.meta }
  });

  res.json({ ok: true, audit: entry });
}

// -------------------------------------------------------------------
// PLC ALERTS
// -------------------------------------------------------------------

export async function createPlcAlert(req, res) {
  const body = req.body || {};
  const alert = {
    id: id("plc"),
    createdAt: isoNow(),
    device: body.device || "PLC-01",
    site: body.site || "Plant Room A",
    severity: (body.severity || "CRITICAL").toUpperCase(),
    code: body.code || "HARDSTOP",
    message: body.message || "Critical fault detected",
    meta: body.meta || {}
  };

  DB.plcAlerts.unshift(alert);

  emit(req, {
    event_name: EVENTS.PLC_ALERT_CREATED,
    topic: "plcAlert",
    action: "created",
    payload: {
      plc_alert_id: alert.id,
      device: alert.device,
      site: alert.site,
      severity: alert.severity,
      code: alert.code,
      message: alert.message
    },
    recipients: { roles: ["DAO_ADMIN", "ENGINEER"] },
    analytics: { role: "SYSTEM", page: "backend", widget_id: "plc_alert", meta: alert.meta }
  });

  res.json({ ok: true, alert });
}

// -------------------------------------------------------------------
// Convenience: list endpoints for dashboards
// -------------------------------------------------------------------

export async function listTickets(_req, res) {
  res.json({ ok: true, tickets: DB.tickets });
}

export async function listTasks(_req, res) {
  res.json({ ok: true, tasks: DB.tasks });
}

export async function listMatches(_req, res) {
  res.json({ ok: true, matches: DB.matches });
}

export async function listDaoCerts(_req, res) {
  res.json({ ok: true, certs: DB.daoCerts });
}

export async function listPlcAlerts(_req, res) {
  res.json({ ok: true, alerts: DB.plcAlerts });
}

export async function listEvidence(_req, res) {
  res.json({ ok: true, evidence: DB.evidence });
}

export async function listAudits(_req, res) {
  res.json({ ok: true, audits: DB.audits });
}

export async function getPolicies(_req, res) {
  res.json({ ok: true, policy: DB.policies });
}

// src/routes/clientTicketRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import Ticket from "../models/Ticket.js";
import * as DSSAdapter from "../services/DSSAdapter.js";
import { enqueueAndDispatchTicket } from "../services/DemoDispatchService.js";

const router = express.Router();

/**
 * DEMO: no JWT, uses demoAuth headers
 * POST /api/client/tickets/demo
 */
router.post("/tickets/demo", async (req, res, next) => {
  const db = req.app.get("models");

  const demoClientId = String(req.headers["x-demo-client-id"] || "client_demo_001");
  const roleContext = String(req.headers["x-demo-role"] || "CLIENT");

  const {
    site = "Level39 – 1 Canada Square",
    summary = "Demo ticket",
    description = "Auto-generated ticket from demo cockpit (manual raise).",
    priority = "HIGH",
    trade = "HVAC",
    depositAmountGBP = 200,
  } = req.body || {};

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: demoClientId,
      scope: "demoClientTicket:create",
      meta: { site, priority, trade },
    });

    const ticket = await Ticket.create({
      clientId: null,
      demoClientId,
      roleContext,
      site,
      summary,
      description,
      priority,
      trade,
      depositAmountGBP,
      status: "ESCROW_HELD",
      origin: "CLIENT",
    });

    await DSSAdapter.recordEvent(db, runId, "ticket", "created", {
      severity: "info",
      actor: demoClientId,
      meta: {
        ticketId: ticket._id.toString(),
        priority: ticket.priority,
        site,
        trade,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "created" });

    await enqueueAndDispatchTicket(ticket);

    return res.status(201).json({ ok: true, ticket });
  } catch (err) {
    next(err);
  }
});

/**
 * REAL: JWT protected
 * POST /api/client/tickets
 */
router.post("/tickets", protect, async (req, res, next) => {
  const db = req.app.get("models");
  const clientId = req.user._id;

  const { site, summary, description, priority, trade, depositAmountGBP } = req.body;

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: clientId.toString(),
      scope: "clientTicket:create",
      meta: { site, priority, trade },
    });

    const ticket = await Ticket.create({
      clientId,
      site,
      summary,
      description,
      priority,
      trade,
      depositAmountGBP,
      status: "ESCROW_HELD",
      origin: "CLIENT",
    });

    await DSSAdapter.recordEvent(db, runId, "ticket", "created", {
      severity: "info",
      actor: clientId.toString(),
      meta: { ticketId: ticket._id.toString() },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "created" });

    await enqueueAndDispatchTicket(ticket);

    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
});

export default router;

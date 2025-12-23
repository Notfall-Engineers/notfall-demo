// api/src/controllers/clientTicketController.js
import mongoose from "mongoose";
import Ticket from "../models/Ticket.js";
import Task from "../models/taskModel.js";
import Payment from "../models/paymentModel.js";

import DaoRevolutAdapter from "../services/DaoRevolutAdapter.js";

// Your existing matching (returns a single engineer user/doc)
import { matchEngineerForTicket } from "../services/TaskMatchingService.js";

// New ranking-based matching (returns ranked list + reasons)
import { matchEngineers } from "../services/matchingEngine.js";
import { listAvailableEngineers } from "../services/engineerRegistry.js";

/**
 * Helper: get widgetBus safely (no circular imports)
 */
function getWidgetBus(req) {
  return req.app?.get("widgetBus") || null;
}

/**
 * Helper: publish safely even if WS bus is not attached
 */
function safeOffer(widgetBus, engineerId, payload) {
  if (!widgetBus?.offerTaskToEngineer) return false;
  widgetBus.offerTaskToEngineer(String(engineerId), payload);
  return true;
}

function safeUpdate(widgetBus, { engineerId, clientId, payload }) {
  if (!widgetBus?.updateTaskForParties) return false;
  widgetBus.updateTaskForParties({
    engineerId: engineerId ? String(engineerId) : null,
    clientId: clientId ? String(clientId) : null,
    taskPayload: payload,
  });
  return true;
}

/**
 * Build a consistent task offer payload for widgets
 */
function buildOfferPayload({ taskId, ticket, deposit, score = null, reasons = [] }) {
  return {
    id: String(taskId),
    title: ticket.summary,
    summary: ticket.summary,
    site: ticket.site,
    trade: ticket.trade,
    priority: ticket.priority,
    status: "OPEN",
    createdAt: new Date().toISOString(),

    slaHours: ticket.priority?.toUpperCase() === "CRITICAL" ? 1 : 2,
    etaMinutes: 30,

    hasJobWallet: true,
    walletAmount: deposit,

    // Matching telemetry (optional but great for UI + audit)
    matchScore: score,
    matchReasons: reasons,
  };
}

/**
 * POST /api/client/tickets
 * Raise a ticket, create escrow, match engineers, offer the task, optionally auto-assign in demo.
 *
 * Behaviour (logical):
 * 1) Create Ticket (dual-write for demo/prod identity)
 * 2) Create Escrow (demo Revolut adapter)
 * 3) Compute ranked engineer matches (top N) and send offers to those engineers only
 * 4) Optionally auto-assign ONE engineer immediately (only if your platform flow does that)
 *
 * NOTE:
 * - If you want “offer first, then engineer accepts”, stop after step 3 and wait for accept endpoint.
 * - If you still want “auto-assign” for demo simplicity, keep step 4 enabled.
 */
export const raiseTicket = async (req, res, next) => {
  try {
    // demoAuth typically sets req.user._id (ObjectId in real, string in demo)
    const userId = req.user?._id ?? req.user?.id;

    const {
      site,
      summary,
      description,
      priority = "MEDIUM",
      trade,
      depositAmountGBP = 200,
      source = "Manual",
      assetId = null,
      plcAlertId = null,

      // optional tuning
      offerTopN = 5,          // offer to top N engineers (ranked)
      autoAssign = true,      // demo-friendly auto-assign switch (set false for offer/accept flow)
    } = req.body;

    if (!userId) return res.status(400).json({ error: "missing_demo_user" });
    if (!site || !summary || !trade) {
      return res.status(400).json({ error: "missing_required_fields" });
    }

    const deposit = Number(depositAmountGBP) || 200;

    const isDemo = Boolean(req.user?.isDemo);
    const isObjectId = mongoose.isValidObjectId(userId);

    // 1) Create Ticket
    const ticket = await Ticket.create({
      site,
      summary,
      description,
      priority,
      trade,
      depositAmountGBP: deposit,
      status: "NEW",
      source,
      assetId,
      plcAlertId,

      clientId: !isDemo && isObjectId ? userId : null,
      demoClientId: isDemo ? String(userId) : null,
    });

    const widgetBus = getWidgetBus(req);

    // Inform client dashboards (if subscribed)
    safeUpdate(widgetBus, {
      engineerId: null,
      clientId: isDemo ? String(userId) : null, // client dashboards in demo may use clientId query
      payload: {
        id: ticket._id.toString(),
        kind: "ticket",
        action: "created",
        ticketId: ticket._id.toString(),
        summary: ticket.summary,
        site: ticket.site,
        trade: ticket.trade,
        priority: ticket.priority,
        status: "NEW",
        createdAt: ticket.createdAt,
      },
    });

    // 2) Create escrow (demo adapter)
    const esc = await DaoRevolutAdapter.createEscrow({
      userId: String(userId),
      workflowId: ticket._id.toString(),
      amountGBP: deposit,
    });

    await Ticket.findByIdAndUpdate(ticket._id, {
      status: "ESCROW_HELD",
      escrowId: esc.id,
    });

    // 3) Ranked matching → offer to top N engineers only
    //    This is compatible with both your demo registry + real system later.
    let ranked = [];
    try {
      const engineers = listAvailableEngineers?.() || [];
      const result = matchEngineers?.({ ticket, engineers });
      ranked = Array.isArray(result?.ranked) ? result.ranked : [];
    } catch {
      ranked = [];
    }

    // Fallback: if ranking engine not available/returns empty, use your existing single-match function
    if (!ranked.length) {
      const single = await matchEngineerForTicket(ticket);
      if (single?._id) {
        ranked = [{ engineerId: single._id.toString(), score: 0.75, reasons: ["fallback_match"] }];
      }
    }

    const top = ranked.slice(0, Math.max(1, Number(offerTopN) || 5));

    // Offer payload uses a task-like id even before task exists
    // For offer/accept flow, this can be ticket-based until task is created.
    const offerId = "WF-" + Math.random().toString(16).slice(2, 8).toUpperCase();

    top.forEach((m) => {
      const payload = buildOfferPayload({
        taskId: offerId,
        ticket,
        deposit,
        score: m.score ?? null,
        reasons: Array.isArray(m.reasons) ? m.reasons : [],
      });

      safeOffer(widgetBus, m.engineerId, payload);
    });

    // 4) Optional demo auto-assign (creates Task + Payment, updates parties)
    //    If you want pure “offer → accept”, set autoAssign=false in request body or default it off.
    let task = null;
    let assignedEngineerId = null;

    if (autoAssign && top.length) {
      // Choose top[0] as assigned engineer in demo
      assignedEngineerId = String(top[0].engineerId);

      const now = Date.now();
      const slaHours = ticket.priority?.toUpperCase() === "CRITICAL" ? 1 : 2;
      const slaDeadline = new Date(now + slaHours * 3600_000);

      task = await Task.create({
        ticketId: ticket._id,
        engineerId: assignedEngineerId,
        title: summary,
        site,
        priority,
        trade,
        status: "ASSIGNED",
        slaHours,
        slaDeadline,
        jobWallet: {
          amount: deposit,
          currency: "GBP",
          rate: 65,
          etaMinutes: 30,
        },
      });

      await Ticket.findByIdAndUpdate(ticket._id, {
        status: "ENGINEER_ASSIGNED",
        engineerId: assignedEngineerId,
        taskId: task._id,
      });

      await Payment.updateOne(
        { workflowId: ticket._id },
        {
          workflowId: ticket._id,
          userId: String(userId),
          engineerId: assignedEngineerId,
          state: "ESCROW_HELD",
          currency: "GBP",
          gross: deposit,
          feePct: 10,
        },
        { upsert: true }
      );

      // Notify assigned parties (engineer + client)
      safeUpdate(widgetBus, {
        engineerId: assignedEngineerId,
        clientId: isDemo ? String(userId) : null,
        payload: {
          id: task._id.toString(),
          ticketId: ticket._id.toString(),
          status: "ASSIGNED",
          title: summary,
          site,
          trade,
          priority,
          slaHours,
          etaMinutes: 30,
          walletAmount: deposit,
        },
      });

      // Withdraw from other engineers (nice UX)
      const others = top.map((m) => String(m.engineerId)).filter((id) => id !== assignedEngineerId);
      if (widgetBus?.withdrawTaskFromEngineers && others.length) {
        widgetBus.withdrawTaskFromEngineers({ taskId: offerId, engineerIds: others });
      }
    }

    return res.status(201).json({
      ticketId: ticket._id,
      escrowId: esc.id,
      status: autoAssign && task ? "ENGINEER_ASSIGNED" : "OFFERED_TO_ENGINEERS",
      taskId: task?._id || null,
      offers: {
        offerId,
        offeredTo: top.map((m) => String(m.engineerId)),
      },
      assignedEngineerId,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/client/tickets
 * Demo users query by demoClientId (string),
 * Production users query by clientId (ObjectId).
 */
export const listMyTickets = async (req, res, next) => {
  try {
    const userId = req.user?._id ?? req.user?.id;
    if (!userId) return res.status(400).json({ error: "missing_demo_user" });

    const isDemo = Boolean(req.user?.isDemo);
    const isObjectId = mongoose.isValidObjectId(userId);

    const query = isDemo
      ? { demoClientId: String(userId) }
      : { clientId: isObjectId ? userId : null };

    if (!isDemo && !isObjectId) return res.json([]);

    const tickets = await Ticket.find(query).sort({ createdAt: -1 }).lean();
    res.json(tickets);
  } catch (err) {
    next(err);
  }
};

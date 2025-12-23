// src/services/DemoDispatchService.js
import EngineerProfile from "../models/EngineerProfile.js";
import Task from "../models/taskModel.js";
import * as widgetBus from "../realtime/widgetBus.js";

function asDemoEngineerId(eng) {
  return (
    eng.engineerId ||
    eng.demoEngineerId ||
    eng.userId?.toString?.() ||
    eng._id?.toString?.()
  );
}

async function matchEngineersForTicket(ticket) {
  const query = { isActive: true };
  if (ticket.trade) query.trades = ticket.trade;

  const engineers = await EngineerProfile.find(query).limit(5).lean().exec();
  if (!engineers.length) return [];

  return engineers.map((eng) => ({
    engineerId: asDemoEngineerId(eng),
    name: eng.name || eng.displayName || "Engineer",
    score: 1
  }));
}

async function createOffersAndBroadcast(ticket) {
  const matches = await matchEngineersForTicket(ticket);

  if (!matches.length) {
    widgetBus.broadcastWidgetEvent({
      topic: "ticket",
      action: "no_match",
      ticketId: ticket._id.toString(),
      severity: ticket.priority || "Medium",
      recipients: { roles: ["CLIENT_FM", "DAO_ADMIN"] }
    });
    return;
  }

  const engineerIds = matches.map((m) => m.engineerId);

  await Task.insertMany(
    matches.map((m) => ({
      ticketId: ticket._id,
      engineerId: m.engineerId,
      status: "OFFERED",
      trade: ticket.trade || "Multi-trade",
      title: ticket.summary,
      location: ticket.site,
      priority: ticket.priority || "Medium",
      slaHours: 2,
      etaMinutes: 30,
      meta: { matchScore: m.score, origin: ticket.origin || "CLIENT" }
    }))
  );

  widgetBus.broadcastWidgetEvent({
    topic: "task",
    action: "offered",
    ticketId: ticket._id.toString(),
    payload: {
      id: ticket._id.toString(),
      trade: ticket.trade || "Multi-trade",
      severity: ticket.priority || "Medium",
      title: ticket.summary,
      status: "NEW",
      location: ticket.site,
      createdAt: ticket.createdAt.toISOString(),
      slaHours: 2,
      etaMinutes: 30,
      hasJobWallet: true,
      walletAmount: Number(ticket.depositAmountGBP || 0)
    },
    recipients: { roles: ["ENGINEER"], engineerIds }
  });
}

export async function enqueueAndDispatchTicket(ticket) {
  widgetBus.broadcastWidgetEvent({
    topic: "ticket",
    action: "created",
    ticketId: ticket._id.toString(),
    payload: {
      ticketId: ticket._id.toString(),
      site: ticket.site,
      summary: ticket.summary,
      severity: ticket.priority || "Medium",
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      origin: ticket.origin || "CLIENT",
      trade: ticket.trade || null,
      depositAmountGBP: Number(ticket.depositAmountGBP || 0)
    },
    recipients: { roles: ["CLIENT_FM", "DAO_ADMIN", "ENGINEER"] }
  });

  await createOffersAndBroadcast(ticket);
}

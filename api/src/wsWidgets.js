// api/src/wsWidgets.js
// Exposes: /ws/widgets
// UK English notes: browsers cannot reliably set headers,
// so identity is read from query string: ?role=ENGINEER&engineerId=...&clientId=...

import { WebSocketServer } from "ws";
import { upsertEngineerState } from "./services/engineerRegistry.js";

/**
 * Topics supported:
 * - task.offer       (matched engineers only)
 * - task.update      (assigned engineer + client)
 * - task.withdrawn   (matched engineers after someone accepts)
 * - asset            (asset created/updated)
 * - plcAlert         (PLC alert stream)
 * - dao.event        (governance actions)
 * - payout           (wallet/payout updates)
 * - system.*         (handshake/subscriptions)
 */

function safeSend(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function parseIdentity(req) {
  const raw = req.url || "";
  const qs = raw.includes("?") ? raw.split("?")[1] : "";
  const params = new URLSearchParams(qs);

  return {
    role: (params.get("role") || "ENGINEER").toString(),
    engineerId: (params.get("engineerId") || "").toString(),
    clientId: (params.get("clientId") || "").toString(),

    // optional meta for registry
    trades: (params.get("trades") || "").toString(), // "HVAC,Electrical"
    etaMinutes: Number(params.get("etaMinutes") || "") || null,
    hourlyRate: Number(params.get("hourlyRate") || "") || null,
  };
}

function normaliseTrades(tradesStr) {
  if (!tradesStr) return null;
  return tradesStr
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function attachWidgetWss(server) {
  // ✅ Single WS server on a path (no manual upgrade handler needed)
  const wss = new WebSocketServer({ server, path: "/ws/widgets" });

  /**
   * Track connections with topic subscriptions
   * client record:
   * { ws, role, engineerId, clientId, topics:Set<string> }
   */
  const clients = new Set();

  /**
   * Fast targeted routing (engineerId -> Set<clientRecord>)
   * Useful for offers + payouts.
   */
  const engineerIndex = new Map();

  /**
   * Fast targeted routing (clientId -> Set<clientRecord>)
   * Useful for client dashboard updates.
   */
  const clientIndex = new Map();

  function indexClient(rec) {
    if (rec.engineerId) {
      if (!engineerIndex.has(rec.engineerId)) engineerIndex.set(rec.engineerId, new Set());
      engineerIndex.get(rec.engineerId).add(rec);
    }
    if (rec.clientId) {
      if (!clientIndex.has(rec.clientId)) clientIndex.set(rec.clientId, new Set());
      clientIndex.get(rec.clientId).add(rec);
    }
  }

  function unindexClient(rec) {
    if (rec.engineerId && engineerIndex.has(rec.engineerId)) {
      engineerIndex.get(rec.engineerId).delete(rec);
      if (engineerIndex.get(rec.engineerId).size === 0) engineerIndex.delete(rec.engineerId);
    }
    if (rec.clientId && clientIndex.has(rec.clientId)) {
      clientIndex.get(rec.clientId).delete(rec);
      if (clientIndex.get(rec.clientId).size === 0) clientIndex.delete(rec.clientId);
    }
  }

  function ensureDefaultTopics(role) {
    // Keep defaults minimal; UI can explicitly subscribe.
    // Engineer dashboards typically want offers + updates.
    if (role === "ENGINEER" || role === "PLC_ENGINEER") {
      return new Set(["task.offer", "task.update", "task.withdrawn", "payout"]);
    }
    // Client/FM typically wants task updates + plc alerts.
    if (role === "CLIENT_FM") {
      return new Set(["task.update", "plcAlert", "asset"]);
    }
    // DAO admins can see governance + payouts + alerts.
    if (role === "DAO_ADMIN") {
      return new Set(["dao.event", "payout", "plcAlert", "asset"]);
    }
    return new Set();
  }

  function roleAllowed(role, topic) {
    // Fine-tune as needed.
    const roleMap = {
      "task.offer": ["ENGINEER", "PLC_ENGINEER", "DAO_ADMIN"],
      "task.update": ["ENGINEER", "PLC_ENGINEER", "CLIENT_FM", "DAO_ADMIN"],
      "task.withdrawn": ["ENGINEER", "PLC_ENGINEER", "DAO_ADMIN"],
      asset: ["ENGINEER", "PLC_ENGINEER", "CLIENT_FM", "DAO_ADMIN"],
      plcAlert: ["ENGINEER", "PLC_ENGINEER", "CLIENT_FM", "DAO_ADMIN"],
      "dao.event": ["DAO_ADMIN"],
      payout: ["ENGINEER", "PLC_ENGINEER", "DAO_ADMIN"],
      "system.hello": ["ENGINEER", "PLC_ENGINEER", "CLIENT_FM", "DAO_ADMIN"],
      "system.subscribed": ["ENGINEER", "PLC_ENGINEER", "CLIENT_FM", "DAO_ADMIN"],
    };

    const allowed = roleMap[topic];
    if (!allowed) return true; // if unknown, allow (demo-friendly)
    return allowed.includes(role);
  }

  // ------------- Connection -------------
  wss.on("connection", (ws, req) => {
    const ident = parseIdentity(req);

    const rec = {
      ws,
      role: ident.role,
      engineerId: ident.engineerId,
      clientId: ident.clientId,
      topics: ensureDefaultTopics(ident.role),
    };

    clients.add(rec);
    indexClient(rec);

    // Update engineer registry (optional)
    if (rec.engineerId) {
      const trades = normaliseTrades(ident.trades) || ["HVAC"];
      upsertEngineerState({
        engineerId: rec.engineerId,
        trades,
        availability: "AVAILABLE",
        etaMinutes: ident.etaMinutes ?? 25,
        hourlyRate: ident.hourlyRate ?? 65,
        daoStatus: "CERTIFIED",
        reputationScore: 82,
        activeTasks: 0,
      });
    }

    safeSend(ws, {
      topic: "system.hello",
      payload: {
        ok: true,
        role: rec.role,
        engineerId: rec.engineerId,
        clientId: rec.clientId,
        note: "Connected to /ws/widgets",
        defaults: Array.from(rec.topics),
      },
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Subscribe: { type:"subscribe", topics:["task.offer","task.update"] }
        if (msg?.type === "subscribe" && Array.isArray(msg.topics)) {
          msg.topics.forEach((t) => rec.topics.add(String(t)));
          safeSend(ws, {
            topic: "system.subscribed",
            payload: { topics: Array.from(rec.topics) },
          });
          return;
        }

        // Optional: client ping/pong, accept/reject hooks later
        // if (msg?.type === "ping") safeSend(ws, { topic: "system.pong", payload: { ts: Date.now() } });
      } catch {
        // ignore malformed messages (demo-friendly)
      }
    });

    ws.on("close", () => {
      clients.delete(rec);
      unindexClient(rec);
    });
  });

  // ------------- Core broadcast helper -------------
  function broadcast(topic, payload, filterFn = null) {
    for (const c of clients) {
      if (!c.topics.has(topic)) continue;
      if (!roleAllowed(c.role, topic)) continue;
      if (filterFn && !filterFn(c)) continue;
      safeSend(c.ws, { topic, payload });
    }
  }

  // ------------- Public API (controllers/services call these) -------------

  /**
   * Matched offer to one engineer only (guarantee).
   * Uses fast engineer index.
   */
  function offerTaskToEngineer(engineerId, taskPayload) {
    const set = engineerIndex.get(String(engineerId));
    if (!set) return;

    for (const c of set) {
      if (!c.topics.has("task.offer")) continue;
      if (!roleAllowed(c.role, "task.offer")) continue;
      safeSend(c.ws, { topic: "task.offer", payload: taskPayload });
    }
  }

  /**
   * Update to assigned engineer + client.
   * Uses indices where possible.
   */
  function updateTaskForParties({ engineerId, clientId, taskPayload }) {
    const eId = engineerId ? String(engineerId) : null;
    const cId = clientId ? String(clientId) : null;

    if (eId) {
      const set = engineerIndex.get(eId);
      if (set) {
        for (const c of set) {
          if (!c.topics.has("task.update")) continue;
          if (!roleAllowed(c.role, "task.update")) continue;
          safeSend(c.ws, { topic: "task.update", payload: taskPayload });
        }
      }
    }

    if (cId) {
      const set = clientIndex.get(cId);
      if (set) {
        for (const c of set) {
          if (!c.topics.has("task.update")) continue;
          if (!roleAllowed(c.role, "task.update")) continue;
          safeSend(c.ws, { topic: "task.update", payload: taskPayload });
        }
      }
    }
  }

  /**
   * Withdraw offer from a list of engineers (after one accepts).
   */
  function withdrawTaskFromEngineers({ taskId, engineerIds }) {
    const ids = Array.isArray(engineerIds) ? engineerIds.map(String) : [];
    ids.forEach((id) => {
      const set = engineerIndex.get(id);
      if (!set) return;
      for (const c of set) {
        if (!c.topics.has("task.withdrawn")) continue;
        if (!roleAllowed(c.role, "task.withdrawn")) continue;
        safeSend(c.ws, { topic: "task.withdrawn", payload: { id: taskId } });
      }
    });
  }

  /**
   * Assets (multi-role).
   */
  function broadcastAsset(assetPayload) {
    broadcast("asset", assetPayload);
  }

  /**
   * PLC alerts (multi-role).
   */
  function broadcastPlcAlert(alertPayload) {
    broadcast("plcAlert", alertPayload);
  }

  /**
   * DAO events (role gated).
   */
  function broadcastDaoEvent(eventPayload) {
    broadcast("dao.event", eventPayload);
  }

  /**
   * Payout updates to engineer + DAO_ADMIN.
   */
  function broadcastPayout(payoutPayload, engineerId = null) {
    const eId = engineerId ? String(engineerId) : null;

    // always send to DAO admins who subscribed
    broadcast("payout", payoutPayload, (c) => c.role === "DAO_ADMIN");

    // send to specific engineer if provided
    if (eId) {
      const set = engineerIndex.get(eId);
      if (!set) return;
      for (const c of set) {
        if (!c.topics.has("payout")) continue;
        if (!roleAllowed(c.role, "payout")) continue;
        safeSend(c.ws, { topic: "payout", payload: payoutPayload });
      }
    }
  }

  /**
   * Generic broadcast for custom topics (demo tools).
   */
  function broadcastWidgetEvent({ topic, payload }) {
    broadcast(topic, payload);
  }

  return {
    // core
    broadcast: broadcastWidgetEvent,

    // task flows
    offerTaskToEngineer,
    updateTaskForParties,
    withdrawTaskFromEngineers,

    // streams
    broadcastAsset,
    broadcastPlcAlert,
    broadcastDaoEvent,
    broadcastPayout,
  };
}

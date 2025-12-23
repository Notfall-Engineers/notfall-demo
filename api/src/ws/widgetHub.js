// src/ws/widgetHub.js
// Notfall Widgets WebSocket Hub
// - Exposes a topic-based pub/sub for dashboards (Engineer / Client-FM / DAO)
// - Supports subscribe/unsubscribe, ping/pong, and role-scoped broadcast
// UK English comments throughout.

import { randomUUID } from "crypto";

const TOPICS = new Set([
  "task",          // task offers, accepted, declined, assigned, status updates
  "ticket",        // ticket created/updated
  "assetRegistry", // assets created/updated
  "plcAlert",      // plc alert new/updated
  "plcAlerts",   // ✅ legacy alias
  "analytics",     // client-side usage events
  "system",        // health, notices
]);

function safeJsonParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export function createWidgetHub({ wss }) {
  // clientId -> { ws, role, engineerId, topics:Set<string>, connectedAt }
  const clients = new Map();

  function register(ws, { role = "ENGINEER", engineerId = null } = {}) {
    const clientId = randomUUID?.() || randomUUID();
    clients.set(clientId, {
      ws,
      role,
      engineerId,
      topics: new Set(["system"]), // default topic
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    });

    ws.send(JSON.stringify({
      topic: "system",
      action: "welcome",
      clientId,
      role,
      engineerId,
      topics: ["system"],
      ts: new Date().toISOString(),
    }));

    return clientId;
  }

  function setClientMeta(clientId, patch = {}) {
    const c = clients.get(clientId);
    if (!c) return;
    if (patch.role) c.role = patch.role;
    if (patch.engineerId !== undefined) c.engineerId = patch.engineerId;
  }

  function subscribe(clientId, topics = []) {
    const c = clients.get(clientId);
    if (!c) return;
    topics.forEach((t) => {
      if (TOPICS.has(t)) c.topics.add(t);
    });
    c.ws.send(JSON.stringify({
      topic: "system",
      action: "subscribed",
      topics: Array.from(c.topics),
      ts: new Date().toISOString(),
    }));
  }

  function unsubscribe(clientId, topics = []) {
    const c = clients.get(clientId);
    if (!c) return;
    topics.forEach((t) => c.topics.delete(t));
    if (!c.topics.size) c.topics.add("system");
    c.ws.send(JSON.stringify({
      topic: "system",
      action: "unsubscribed",
      topics: Array.from(c.topics),
      ts: new Date().toISOString(),
    }));
  }

  function remove(clientId) {
    clients.delete(clientId);
  }

  // Role gating (simple, extend as needed)
  function canReceive({ role, engineerId }, msg) {
    // If recipients is not set: broadcast to any subscribed client.
    if (!msg.recipients) return true;

    const r = msg.recipients;

    // recipients.roles: ["ENGINEER","CLIENT_FM","DAO_ADMIN"]
    if (Array.isArray(r.roles) && r.roles.length) {
      if (!r.roles.includes(role)) return false;
    }

    // recipients.engineerIds: ["eng_demo", ...]
    if (Array.isArray(r.engineerIds) && r.engineerIds.length) {
      if (!engineerId) return false;
      if (!r.engineerIds.includes(engineerId)) return false;
    }

    return true;
  }

  function publish(msg) {
    if (!msg || !msg.topic || !TOPICS.has(msg.topic)) return;

    const payload = {
      ...msg,
      ts: msg.ts || new Date().toISOString(),
    };

    const raw = JSON.stringify(payload);

    for (const [clientId, c] of clients.entries()) {
      if (c.ws.readyState !== 1) continue; // OPEN
      if (!c.topics.has(payload.topic)) continue;
      if (!canReceive(c, payload)) continue;

      try {
        c.ws.send(raw);
      } catch {
        // If a send fails, drop the client
        try { c.ws.close(); } catch {}
        remove(clientId);
      }
    }
  }

  // Keep-alive (prevents idle timeouts behind proxies)
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [clientId, c] of clients.entries()) {
      if (c.ws.readyState !== 1) continue;
      // drop dead connections if no activity for 2 minutes
      if (now - c.lastSeenAt > 120_000) {
        try { c.ws.close(); } catch {}
        remove(clientId);
        continue;
      }
      try {
        c.ws.send(JSON.stringify({ topic: "system", action: "ping", ts: new Date().toISOString() }));
      } catch {}
    }
  }, 25_000);

  wss.on("close", () => clearInterval(interval));

  function attachWs(ws, req) {
    // Accept identifiers from query string:
    // /ws/widgets?role=ENGINEER&engineerId=eng_demo
    const url = new URL(req.url, `http://${req.headers.host}`);
    const role = (url.searchParams.get("role") || "ENGINEER").toUpperCase();
    const engineerId = url.searchParams.get("engineerId") || null;

    const clientId = register(ws, { role, engineerId });

    ws.on("message", (raw) => {
      const msg = safeJsonParse(raw?.toString?.() || raw);
      const c = clients.get(clientId);
      if (c) c.lastSeenAt = Date.now();

      if (!msg) return;

      // Client control messages
      if (msg.type === "subscribe") return subscribe(clientId, msg.topics || []);
      if (msg.type === "unsubscribe") return unsubscribe(clientId, msg.topics || []);
      if (msg.type === "hello") {
        // allow client to change meta after connect (e.g. role switching in UI)
        setClientMeta(clientId, {
          role: msg.role ? String(msg.role).toUpperCase() : undefined,
          engineerId: msg.engineerId ?? undefined,
        });
        return ws.send(JSON.stringify({
          topic: "system",
          action: "hello_ack",
          role: clients.get(clientId)?.role,
          engineerId: clients.get(clientId)?.engineerId,
          ts: new Date().toISOString(),
        }));
      }

      // Optional: allow analytics events from client → backend
      if (msg.topic === "analytics") {
        // You will forward this to BigQuery (see section 2)
        // Still publish internally if you want live “Demo performance” widget updates
        publish(msg);
      }
    });

    ws.on("close", () => remove(clientId));
    ws.on("error", () => remove(clientId));
  }

  return { publish, attachWs };
}

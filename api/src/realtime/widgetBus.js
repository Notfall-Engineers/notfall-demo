// api/src/realtime/widgetBus.js
import { WebSocketServer } from "ws";

let wss = null;
let hub = null;

/**
 * ✅ Bind legacy widgetBus to the new WidgetHub (src/ws/widgetHub.js)
 * Call once from src/index.js after installWidgetWs().
 */
export function setHub(widgetHub) {
  hub = widgetHub || null;
  if (hub) {
    console.log("[widgetBus] Bound to widgetHub (legacy adapter enabled)");
  }
}

/**
 * Legacy initialiser (older callers).
 * IMPORTANT: If hub is bound, we do NOT need to spin up a second WSS.
 */
export function init(server) {
  if (hub) {
    console.log("[widgetBus] init() skipped (hub is bound)");
    return null;
  }
  if (wss) return wss;

  wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    socket._topics = new Set();

    socket.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "subscribe" && msg.topic) {
        socket._topics.add(msg.topic);
      }
    });
  });

  console.log("[widgetBus] WebSocketServer initialised (legacy)");
  return wss;
}

/**
 * ✅ Unified broadcaster:
 * - If hub exists → publish via hub (modern /ws/widgets)
 * - Else → fallback to legacy WSS broadcast (older clients)
 */
export function broadcastWidgetEvent(event) {
  // Prefer hub (the one your UI uses)
  if (hub?.publish) {
    // Allow old callers to pass payload nested or flat
    const topic = event.topic;
    const action = event.action;

    const payload =
      event.payload !== undefined
        ? event.payload
        : Object.fromEntries(
            Object.entries(event).filter(
              ([k]) => !["topic", "action", "recipients"].includes(k)
            )
          );

    hub.publish({
      topic,
      action,
      payload,
      recipients: event.recipients
    });
    return;
  }

  // Legacy fallback
  if (!wss) return;

  const raw = JSON.stringify({
    type: "widget-event",
    ...event
  });

  for (const socket of wss.clients) {
    if (socket.readyState !== 1) continue;

    if (event.topic && socket._topics && socket._topics.size > 0) {
      if (!socket._topics.has(event.topic)) continue;
    }

    try {
      socket.send(raw);
    } catch (err) {
      console.warn("[widgetBus] send failed:", err.message);
    }
  }
}

export function broadcastPlcAlert(alert) {
  broadcastWidgetEvent({
    topic: "plcAlert",
    action: "plcAlert",
    payload: { alert }
  });
}

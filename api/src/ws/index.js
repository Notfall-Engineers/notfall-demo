// src/ws/index.js
import { WebSocketServer } from "ws";
import { createWidgetHub } from "./widgetHub.js";

export function installWidgetWs({ server }) {
  // One WSS for the whole app; we route by path.
  const wss = new WebSocketServer({ noServer: true });
  const hub = createWidgetHub({ wss });

  server.on("upgrade", (req, socket, head) => {
    const { url } = req;
    if (!url) return socket.destroy();

    // Only accept /ws/widgets
    if (!url.startsWith("/ws/widgets")) return socket.destroy();

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      hub.attachWs(ws, req);
    });
  });

  return hub;
}

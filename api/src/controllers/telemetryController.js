import TelemetryEvent from "../models/telemetryEventModel.js";

/**
 * POST /api/telemetry
 * Stores raw demo telemetry events coming from FakeAPI.js
 */
export async function postTelemetry(req, res, next) {
  try {
    const body = req.body || {};
    const type = body.type || body.event || "telemetry";

    const doc = await TelemetryEvent.create({
      userId: body.userId || body.clientId || req.headers["x-demo-client-id"] || null,
      workflowId: body.workflowId || null,
      role: body.role || req.headers["x-demo-role"] || null,
      type: String(type),
      payload: body,
      createdAt: new Date(),
    });

    // Optional: broadcast to widgets (if your ws bus supports it)
    const bus = req.app.get("widgetBus");
    if (bus?.broadcast) {
      bus.broadcast({ topic: "analytics", action: "telemetry", payload: doc });
    }

    res.json({ ok: true, id: doc._id });
  } catch (e) {
    next(e);
  }
}

import AnalyticsEvent from "../models/analyticsEventModel.js";

/**
 * POST /api/analytics/track
 * POST /api/demo-analytics/event
 */
export async function postTrack(req, res, next) {
  try {
    const body = req.body || {};
    const name = body.name || body.event || "event";

    const doc = await AnalyticsEvent.create({
      name: String(name).toLowerCase(),
      sessionId: body.sessionId || null,
      role: body.role || req.headers["x-demo-role"] || null,
      engineerId: body.engineerId || req.headers["x-demo-engineer-id"] || null,
      clientId: body.clientId || req.headers["x-demo-client-id"] || null,
      props: body.props || body.data || body,
      createdAt: new Date(),
    });

    // Optional: WS broadcast
    const bus = req.app.get("widgetBus");
    if (bus?.broadcast) {
      bus.broadcast({ topic: "analytics", action: "event", payload: doc });
    }

    res.json({ ok: true, id: doc._id });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/demo-analytics/summary?sinceHours=24
 */
export async function getSummary(req, res, next) {
  try {
    const sinceHours = Number(req.query.sinceHours || 24);
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    const events = await AnalyticsEvent.find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(500);

    const counts = {};
    for (const e of events) counts[e.name] = (counts[e.name] || 0) + 1;

    res.json({
      mode: "API",
      since: since.toISOString(),
      total: events.length,
      counts,
      latest: events.slice(0, 80),
    });
  } catch (e) {
    next(e);
  }
}

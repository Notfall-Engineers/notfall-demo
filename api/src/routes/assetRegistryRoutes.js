// api/src/routes/assetRegistryRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import * as DSSAdapter from "../services/DSSAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";

import Asset from "../models/assetModel.js";
import PlcAlert from "../models/plcAlertModel.js";

const router = express.Router();

/**
 * Demo-friendly auth:
 *  - If Authorization: Bearer ... is present → enforce real JWT via protect()
 *  - Else → allow through; demoAuth has already set req.user based on x-demo-role
 */
router.use((req, res, next) => {
  const authHeader = req.headers["authorization"] || "";
  const hasBearer = authHeader.toLowerCase().startsWith("bearer ");
  if (hasBearer) {
    return protect(req, res, next);
  }
  return next();
});

/**
 * DSS guards: tag each request with a runId + context
 */
router.use((req, res, next) =>
  DSSAdapter.applyRequestGuards(req, res, next)
);

/**
 * GET /api/assets
 * List assets for current client/FM (or all assets in demo mode)
 */
router.get("/", async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user?._id?.toString?.();

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId || "anonymous",
      scope: "assetRegistry:list",
      meta: { role: req.user?.role || "UNKNOWN" },
    });

    const query = {};

    // In real mode, scope assets by clientId
    if (userId && !req.user?.isDemo) {
      query.clientId = userId;
    }

    const assets = await Asset.find(query).lean();

    await DSSAdapter.recordEvent(db, runId, "assetRegistry", "list", {
      severity: "info",
      actor: userId || "anonymous",
      meta: {
        count: assets.length,
        role: req.user?.role || "UNKNOWN",
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    res.json(assets);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assets
 * Create a new asset.
 */
router.post("/", async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user?._id?.toString?.();

  const {
    name,
    code,
    siteName,
    siteCode,
    type,
    criticality,
    plcTag,
    meta,
  } = req.body || {};

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId || "anonymous",
      scope: "assetRegistry:create",
      meta: { name, siteName },
    });

    if (!name || !siteName) {
      await DSSAdapter.recordEvent(db, runId, "assetRegistry", "create", {
        severity: "warning",
        actor: userId || "anonymous",
        message: "Missing required fields when creating asset",
        meta: { name, siteName },
      });

      await DSSAdapter.finishRun(db, runId, { status: "failed" });

      return res.status(400).json({
        error: "missing_required_fields",
        message: "name and siteName are required",
      });
    }

    const asset = new Asset({
      name,
      code,
      siteName,
      siteCode,
      type,
      criticality: criticality || "Medium",
      plcTag: plcTag || null,
      meta: meta || {},
      clientId: userId || null,
      createdBy: userId || null,
    });

    await asset.save();

    await DSSAdapter.recordEvent(db, runId, "assetRegistry", "create", {
      severity: "info",
      actor: userId || "anonymous",
      message: "Asset created",
      meta: {
        assetId: asset._id.toString(),
        name: asset.name,
        siteName: asset.siteName,
        criticality: asset.criticality,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // Notify widgets (Client/FM + Engineer views)
    widgetBus.broadcastWidgetEvent({
      topic: "asset",
      action: "created",
      payload: {
        id: asset._id.toString(),
        name: asset.name,
        code: asset.code,
        siteName: asset.siteName,
        siteCode: asset.siteCode,
        criticality: asset.criticality,
        plcTag: asset.plcTag,
      },
    });

    res.status(201).json(asset);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/assets/plc-alerts
 * List recent PLC alerts for the current tenant (or all in demo mode).
 */
router.get("/plc-alerts", async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user?._id?.toString?.();

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId || "anonymous",
      scope: "assetRegistry:plcAlerts:list",
      meta: { role: req.user?.role || "UNKNOWN" },
    });

    const query = {};
    if (userId && !req.user?.isDemo) {
      query.clientId = userId;
    }

    const alerts = await PlcAlert.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    await DSSAdapter.recordEvent(
      db,
      runId,
      "assetRegistry",
      "plcAlerts:list",
      {
        severity: "info",
        actor: userId || "anonymous",
        meta: { count: alerts.length },
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    res.json(alerts);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assets/plc-alerts
 * Ingest a PLC alert from Node-RED / OPC UA bridge.
 */
router.post("/plc-alerts", async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user?._id?.toString?.();

  const {
    assetId,
    severity,
    code,
    message,
    plcTag,
    siteName,
    siteCode,
    meta,
  } = req.body || {};

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId || "plc-bridge",
      scope: "assetRegistry:plcAlert:create",
      meta: { severity, code, siteName },
    });

    if (!message && !code) {
      await DSSAdapter.recordEvent(
        db,
        runId,
        "assetRegistry",
        "plcAlert:create",
        {
          severity: "warning",
          actor: userId || "plc-bridge",
          message: "PLC alert missing code/message",
          meta: { code, message },
        }
      );

      await DSSAdapter.finishRun(db, runId, { status: "failed" });

      return res.status(400).json({
        error: "missing_required_fields",
        message: "code or message is required for PLC alert",
      });
    }

    const alert = new PlcAlert({
      assetId: assetId || null,
      clientId: userId || null,
      severity: severity || "Medium",
      code: code || null,
      message: message || "",
      plcTag: plcTag || null,
      siteName: siteName || null,
      siteCode: siteCode || null,
      meta: meta || {},
    });

    await alert.save();

    await DSSAdapter.recordEvent(
      db,
      runId,
      "assetRegistry",
      "plcAlert:create",
      {
        severity: "info",
        actor: userId || "plc-bridge",
        message: "PLC alert ingested",
        meta: {
          alertId: alert._id.toString(),
          assetId: alert.assetId?.toString?.() || null,
          severity: alert.severity,
          siteName: alert.siteName,
        },
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // Broadcast to all widgets listening to "plcAlert"
    widgetBus.broadcastWidgetEvent({
      topic: "plcAlert",
      action: "created",
      payload: {
        id: alert._id.toString(),
        assetId: alert.assetId?.toString?.() || null,
        severity: alert.severity,
        code: alert.code,
        message: alert.message,
        plcTag: alert.plcTag,
        siteName: alert.siteName,
        siteCode: alert.siteCode,
        createdAt: alert.createdAt,
      },
    });

    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/assets/plc-alerts/test
 * Demo-only endpoint to inject a synthetic PLC alert
 * Used by PLC Engineer Console "Test PLC fault".
 */
router.post("/plc-alerts/test", async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user?._id?.toString?.() || "demo-tester";

  const {
    assetId,
    siteCode,
    siteName,
    severity = "CRITICAL",
    code = "CHILLER_HP_TRIP",
    message = "High pressure trip on primary chiller",
  } = req.body || {};

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId,
      scope: "assetRegistry:plcAlert:testCreate",
      meta: { severity, code, siteName },
    });

    let asset = null;
    if (assetId) {
      asset = await Asset.findById(assetId);
    }
    if (!asset) {
      asset =
        (await Asset.findOne({ siteCode }).sort({ updatedAt: -1 })) ||
        (await Asset.findOne().sort({ updatedAt: -1 }));
    }

    const alert = new PlcAlert({
      assetId: asset ? asset._id : null,
      clientId: null,
      severity,
      code,
      message,
      plcTag: "DB1.FaultCode",
      siteName: asset?.siteName || siteName || "Demo Canary Wharf Site",
      siteCode: asset?.siteCode || siteCode || "DEMO-SITE-01",
      meta: { source: "TEST" },
    });

    await alert.save();

    await DSSAdapter.recordEvent(
      db,
      runId,
      "assetRegistry",
      "plcAlert:testCreate",
      {
        severity: "warning",
        actor: userId,
        message: "Test PLC alert created",
        meta: {
          alertId: alert._id.toString(),
          assetId: alert.assetId?.toString?.() || null,
          severity: alert.severity,
          siteName: alert.siteName,
        },
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // Broadcast to widgets listening to "plcAlert"
    widgetBus.broadcastWidgetEvent({
      topic: "plcAlert",
      action: "created",
      payload: {
        id: alert._id.toString(),
        assetId: alert.assetId?.toString?.() || null,
        severity: alert.severity,
        code: alert.code,
        message: alert.message,
        plcTag: alert.plcTag,
        siteName: alert.siteName,
        siteCode: alert.siteCode,
        createdAt: alert.createdAt,
        source: "TEST",
      },
    });

    res.status(201).json(alert);
  } catch (err) {
    next(err);
  }
});

export default router;

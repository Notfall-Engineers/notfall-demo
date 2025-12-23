// src/index.js
import "dotenv/config";
import http from "http";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";

import { installWidgetWs } from "./ws/index.js";
import * as widgetBus from "./realtime/widgetBus.js"; // ✅ NEW: legacy broadcaster bridge

import { AnalyticsService } from "./services/AnalyticsService.js";
import { buildAnalyticsRoutes } from "./routes/analyticsRoutes.js";
import { buildDemoTaskRoutes } from "./routes/demoTaskRoutes.js";

// Routes (full system)
import waitlistRoutes from "./routes/waitlistRoutes.js";
import demoRoutes from "./routes/demoRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import engineerRoutes from "./routes/engineerRoutes.js";
import clientTicketRoutes from "./routes/clientTicketRoutes.js";
import clientProfileRoutes from "./routes/clientProfileRoutes.js";
import assetRegistryRoutes from "./routes/assetRegistryRoutes.js";
import daoDemoRoutes from "./routes/daoDemoRoutes.js";

// Other endpoints
import telemetryRoutes from "./routes/telemetryRoutes.js";
import demoAnalyticsRoutes from "./routes/demoAnalyticsRoutes.js";
import paymentsRoutes from "./routes/paymentsRoutes.js";

// Telemetry controller (for /api/demo/telemetry)
import { postTelemetry } from "./controllers/telemetryController.js";

import { demoAuth } from "./middleware/demoAuth.js";
import { errorHandler } from "./middleware/errorHandler.js";

// DSS models (for DSSAdapter.resolveModels)
import DSSRun from "./models/dssRunModel.js";
import AuditLog from "./models/auditEventModel.js";
import ExecutionLog from "./models/executionLogModel.js";
import EmailLog from "./models/emailLogModel.js";

// env
import { PORT as ENV_PORT, ALLOWED_ORIGINS } from "./config/env.js";

// ---------- ESM helpers ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- App ----------
const app = express();
app.set("trust proxy", 1);

// Attach DSS models (for DSSAdapter.resolveModels)
app.set("models", {
  DSSRun,
  AuditLog,
  ExecutionLog,
  EmailLog
});

// ---------- Security + performance ----------
// ✅ KEY: disable Helmet CSP globally so nothing can revert to script-src 'self'
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
  })
);

// ✅ Demo-only CSP that allows your CDN scripts for /demo/*
const demoCsp = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],

    // React/Babel/Tailwind CDNs
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "https://unpkg.com",
      "https://cdn.tailwindcss.com",
      "https://cdn.jsdelivr.net"
    ],
    styleSrc: [
      "'self'",
      "'unsafe-inline'",
      "https://fonts.googleapis.com",
      "https://cdn.jsdelivr.net"
    ],
    fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
    imgSrc: ["'self'", "data:", "blob:"],

    // allow API + WS
    connectSrc: ["'self'", "ws:", "wss:"]
  }
});

// Apply demo CSP only for /demo routes (static)
app.use((req, res, next) => {
  if (req.path.startsWith("/demo")) return demoCsp(req, res, next);
  return next();
});

app.use(compression());

// Body limits
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// Logging
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Rate limiting (demo-friendly)
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false
  })
);

// ---------- CORS ----------
const defaultOrigins = [
  "http://localhost:5173",
  "http://localhost:8080",
  "http://localhost",
  "https://notfallengineers.co.uk",
  "https://www.notfallengineers.co.uk",
  "https://notfallengineers.com",
  "https://www.notfallengineers.com"
];

const configuredOrigins = Array.isArray(ALLOWED_ORIGINS)
  ? ALLOWED_ORIGINS
  : typeof ALLOWED_ORIGINS === "string" && ALLOWED_ORIGINS.trim()
    ? ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : [];

const allowlist = configuredOrigins.length ? configuredOrigins : defaultOrigins;

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl/health checks
    if (allowlist.includes(origin)) return cb(null, true);

    // dev-friendly localhost allowance
    try {
      const u = new URL(origin);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return cb(null, true);
    } catch {}

    return cb(new Error(`CORS blocked for origin: ${origin}`), false);
  },
  credentials: false,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-demo-role", "x-demo-engineer-id", "x-demo-client-id"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ---------- Static hosting ----------
const staticRoot = path.resolve(__dirname, "../../htdocs");
app.use(express.static(staticRoot, { maxAge: "1h", etag: true }));

// ---------- Fix: stop 404 spam for GET /demo/widgets?... ----------
app.get("/demo/widgets", (req, res) => {
  const role = String(req.query.role || "ENGINEER");
  const engineerId = String(req.query.engineerId || "eng_demo");
  const clientId = String(req.query.clientId || "client_demo_001");

  const wsPath = `/ws/widgets?role=${encodeURIComponent(role)}&engineerId=${encodeURIComponent(
    engineerId
  )}&clientId=${encodeURIComponent(clientId)}`;

  res.json({
    ok: true,
    hint: "Use WebSocket (Upgrade) on wsPath. HTTP GET is only a discovery endpoint.",
    wsPath
  });
});

// ---------- Demo auth shim ----------
app.use((req, _res, next) => {
  if (!req.path.startsWith("/api/")) return next();

  // only assist demo client endpoints
  if (req.path.startsWith("/api/client")) {
    if (!req.headers["x-demo-role"]) req.headers["x-demo-role"] = "CLIENT_FM";
    if (!req.headers["x-demo-client-id"]) req.headers["x-demo-client-id"] = "client_demo_001";
  }

  // engineer dashboard convenience
  if (req.path.startsWith("/api/engineer")) {
    if (!req.headers["x-demo-role"]) req.headers["x-demo-role"] = "ENGINEER";
    if (!req.headers["x-demo-engineer-id"]) req.headers["x-demo-engineer-id"] = "eng_demo";
  }

  next();
});

// Apply demoAuth for /api after the default header shim
app.use("/api", demoAuth);

// ---------- Server + WebSocket ----------
const server = http.createServer(app);

/**
 * ✅ Canonical Widgets WS hub
 */
export const widgetHub = installWidgetWs({ server });

/**
 * ✅ CRITICAL FIX:
 * Bind the legacy broadcaster (realtime/widgetBus.js) to the new hub,
 * so DemoDispatchService.js and older route modules instantly publish
 * into /ws/widgets and the UI receives again.
 */
widgetBus.setHub(widgetHub);

// Back-compat alias (some older files may expect widgetBus)
export const widgetBusCompat = widgetHub;

// ✅ Make available via app.locals
app.locals.widgetHub = widgetHub;
app.locals.widgetBus = widgetHub;

// Also attach to app settings for older call-sites
app.set("widgetBus", widgetHub);

/**
 * Convenience wrapper controllers can import:
 * publishEvent({ topic, action, payload, recipients })
 */
export function publishEvent({ topic, action, payload, recipients }) {
  widgetHub.publish({
    topic,
    action,
    payload,
    recipients: recipients || { roles: ["ENGINEER", "CLIENT_FM", "DAO_ADMIN"] }
  });
}

// ---------- Analytics (BigQuery-ready) ----------
const analyticsService = new AnalyticsService({
  projectId: process.env.GCP_PROJECT_ID,
  datasetId: process.env.BQ_DATASET_ID || "notfall_demo_analytics",
  tableId: process.env.BQ_TABLE_ID || "events",
  enabled: process.env.ANALYTICS_ENABLED === "true",
  batchSize: Number(process.env.BQ_BATCH_SIZE || 50),
  flushMs: Number(process.env.BQ_FLUSH_MS || 2000),
  strictCanonical: true,
  demoSafe: true,
  ensureTable: process.env.BQ_ENSURE_TABLE === "true",
  bqLocation: process.env.BQ_LOCATION || "EU",
  consoleSinkWhenDisabled: process.env.ANALYTICS_CONSOLE_SINK === "true"
});

try {
  await analyticsService.start?.();
} catch (e) {
  console.warn("Analytics service start skipped:", e?.message || e);
}

app.locals.analytics = analyticsService;

export function trackEvent(event) {
  try {
    analyticsService.enqueue?.(event || {});
  } catch (e) {
    console.warn("trackEvent enqueue failed:", e?.message || e);
  }
}

app.use("/api/analytics", buildAnalyticsRoutes({ analytics: analyticsService }));

app.post("/api/analytics/track", (req, res) => {
  try {
    analyticsService.enqueue?.(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "track failed" });
  }
});

function publishAnalytics(event) {
  const payload = event || {};
  trackEvent(payload);

  try {
    widgetHub.publish({
      topic: "analytics",
      action: "event",
      payload,
      recipients: { roles: ["DAO_ADMIN"] }
    });
  } catch (e) {
    console.warn("Analytics WS publish failed:", e?.message || e);
  }
}

export const Analytics = { publishAnalytics };

// ---------- API routes (full system) ----------
app.use("/api/auth", authRoutes);
app.use("/api/engineer", engineerRoutes);
app.use("/api/client", clientTicketRoutes);
app.use("/api/client-profile", clientProfileRoutes);
app.use("/api/assets", assetRegistryRoutes);
app.use("/api/dao-demo", daoDemoRoutes);
app.use("/api/demo", demoRoutes);
app.use("/api/waitlist", waitlistRoutes);

// Other endpoints
app.use("/api/telemetry", telemetryRoutes);
app.use("/api/demo-analytics", demoAnalyticsRoutes);
app.use("/api/payments", paymentsRoutes);

// ✅ Fix the 404 spam from FakeAPI calling /api/demo/telemetry directly
app.post("/api/demo/telemetry", postTelemetry);

// ✅ New demo task routes (your canonical event simulator)
app.use("/api/demo-tasks", buildDemoTaskRoutes());

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "ok", service: "notfall-api", timestamp: new Date().toISOString() });
});

app.get("/api", (_req, res) => {
  res.json({ status: "Notfall API running", message: "Mongo-backed DAO waitlist & demo" });
});

// 404 handler for /api only
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
});

app.use(errorHandler);

// ✅ Boot message
try {
  publishEvent({
    topic: "system",
    action: "boot",
    payload: { message: "Notfall API + Widgets WS online", ts: new Date().toISOString() },
    recipients: { roles: ["ENGINEER", "CLIENT_FM", "DAO_ADMIN"] }
  });
} catch (e) {
  console.warn("WS boot publish skipped:", e?.message || e);
}

// ---------- Startup ----------
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/notfall_demo";
const PORT = Number(ENV_PORT || process.env.PORT || 8080);

async function start() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Mongo connected:", MONGO_URI);

    server.listen(PORT, () => {
      console.log(`Notfall API + WS running on :${PORT}`);
      console.log(`WS endpoint: ws://localhost:${PORT}/ws/widgets?role=ENGINEER&engineerId=eng_demo`);
    });
  } catch (err) {
    console.error("Failed to start API:", err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  console.log(`[${signal}] Shutting down...`);

  try {
    await analyticsService.stop?.({ flush: true });
  } catch {}

  Promise.allSettled([
    new Promise((resolve) => server.close(resolve)),
    mongoose.connection.close(false)
  ]).finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();

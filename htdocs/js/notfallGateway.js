/* C:\Users\Student\Desktop\notfall-demo\htdocs\js\notfallGateway.js
 * Notfall Gateway Browser SDK (Thin Client)
 * -------------------------------------------------------------
 * Design rules (Google-grade):
 *  - NO business logic
 *  - NO localStorage as source of truth
 *  - ALL state is server-authoritative (Mongo/outbox/PubSub)
 *  - SDK only:
 *      - sets identity headers (role/clientId/engineerId)
 *      - calls REST endpoints
 *      - opens WebSocket for realtime delivery
 *      - sends analytics/usage events (optional)
 *
 * Multi-tenant scaling:
 *  - 20 clients + 100 engineers + DAO observers is safe because:
 *      - all reads are server-filtered by role/clientId/engineerId
 *      - WS subscriptions are scoped server-side
 *
 * Auth modes:
 *  - DEMO: demoAuth header shim (x-demo-*)
 *  - LIVE: JWT required for UI routes; partner routes use API key via Gateway
 */

(() => {
  const DEFAULTS = {
    // Server base (same for local + Cloud Run)
    apiBase: "http://localhost:8080",
    wsBase: "ws://localhost:8080/ws/widgets",

    // Environment flags (set by your HTML or bootstrap)
    appEnv: "demo", // "demo" | "live"

    // Partner API key (ONLY for partner endpoints, normally injected by backend or Gateway)
    partnerApiKey: null,

    // Optional bearer JWT for live UI routes
    jwt: null,

    // Default identity (SDK will send these as headers)
    role: "ENGINEER",        // ENGINEER | CLIENT_FM | DAO_ADMIN
    clientId: "client_demo", // required for client scoping
    engineerId: "eng_demo",  // required for engineer scoping

    // Correlation IDs
    correlationHeader: "x-correlation-id",
  };

  const cfg = { ...DEFAULTS };

  // In-memory only (NOT source of truth)
  let sharedSocket = null;

  // -------------------- Helpers --------------------
  const nowISO = () => new Date().toISOString();
  const uuid = () =>
    (window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);

  function upper(x) {
    return String(x || "").toUpperCase();
  }

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function buildHeaders(extra = {}) {
    const h = {
      "Content-Type": "application/json",

      // Demo identity headers (your backend shim already uses these)
      "x-demo-role": upper(cfg.role),
      "x-demo-client-id": String(cfg.clientId || ""),
      "x-demo-engineer-id": String(cfg.engineerId || ""),

      // Correlation ID (traceability)
      [cfg.correlationHeader]: extra[cfg.correlationHeader] || uuid(),

      ...extra,
    };

    // Live UI JWT (if configured)
    if (cfg.jwt && !h.Authorization) {
      h.Authorization = `Bearer ${cfg.jwt}`;
    }

    // Partner key (only used by partner endpoints; on GCP you normally rely on API Gateway key)
    if (cfg.partnerApiKey && !h["x-api-key"]) {
      h["x-api-key"] = cfg.partnerApiKey;
    }

    return h;
  }

  async function http(path, { method = "GET", body = null, headers = {} } = {}) {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      method,
      headers: buildHeaders(headers),
      body: body ? JSON.stringify(body) : null,
    });

    const text = await res.text();
    const json = text ? safeJsonParse(text) : null;

    if (!res.ok) {
      const msg = json?.error || json?.message || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  }

  function wsUrl() {
    // WS query string is only hinting; real scoping is enforced server-side.
    const q = new URLSearchParams({
      role: upper(cfg.role),
      engineerId: cfg.engineerId || "",
      clientId: cfg.clientId || "",
    });
    return `${cfg.wsBase}?${q.toString()}`;
  }

  function getWidgetSocket() {
    // Single shared socket for the UI
    if (sharedSocket && sharedSocket.readyState === 1) return sharedSocket;

    const sock = new WebSocket(wsUrl());
    sharedSocket = sock;

    // auto-subscribe common topics per role (server can still enforce)
    sock.addEventListener("open", () => {
      try {
        sock.send(JSON.stringify({
          type: "hello",
          role: upper(cfg.role),
          engineerId: cfg.engineerId || null,
          clientId: cfg.clientId || null,
        }));
      } catch {}
    });

    return sharedSocket;
  }

  function setRole(role) {
    cfg.role = upper(role || "ENGINEER");
    // server-truth: optionally tell backend (demo helper)
    return http("/api/demo/role", { method: "POST", body: { role: cfg.role } })
      .catch(() => ({ role: cfg.role }));
  }

  function getRole() {
    return http("/api/demo/role", { method: "GET" })
      .catch(() => ({ role: cfg.role, engineerId: cfg.engineerId, clientId: cfg.clientId }));
  }

  function setEngineerId(engineerId) {
    cfg.engineerId = String(engineerId || "");
    return { engineerId: cfg.engineerId };
  }

  // -------------------- Analytics (server authoritative) --------------------
  function track(eventName, meta = {}) {
    // Always server-side for BigQuery / usage / audit
    return http("/api/analytics/track", {
      method: "POST",
      body: { event: String(eventName || "event"), meta: meta || {}, at: nowISO() },
    });
  }

  function startFeature(feature) {
    return track("feature_start", { feature });
  }

  function endFeature(feature) {
    return track("feature_end", { feature });
  }

  function getDemoAnalyticsSummary() {
    return http("/api/demo-analytics/summary", { method: "GET" });
  }

  // -------------------- Demographics --------------------
  function getDemographics() {
    return http("/api/demo/demographics", { method: "GET" });
  }

  function setDemographics(payload) {
    return http("/api/demo/demographics", { method: "POST", body: payload || {} });
  }

  // -------------------- Engineer profile --------------------
  function getEngineerProfile() {
    return http("/api/engineer/profile", { method: "GET" });
  }

  function saveEngineerProfile(profile) {
    return http("/api/engineer/profile", { method: "POST", body: profile || {} });
  }

  // Profile helper buttons (server stores uploads/fields; demo can accept simple payloads)
  function addCertification(cert) {
    return http("/api/engineer/profile/certifications", { method: "POST", body: cert || {} });
  }

  function addDBS(dbs) {
    return http("/api/engineer/profile/dbs", { method: "POST", body: dbs || {} });
  }

  function addInsurance(ins) {
    return http("/api/engineer/profile/insurance", { method: "POST", body: ins || {} });
  }

  // -------------------- DAO --------------------
  function getDAOStatus() {
    return http("/api/dao-demo/status", { method: "GET" });
  }

  function submitProfileToDAO() {
    return http("/api/dao-demo/submit", { method: "POST" });
  }

  function resubmitDAO() {
    return http("/api/dao-demo/resubmit", { method: "POST" });
  }

  function getDaoQueue() {
    return http("/api/dao-demo/queue", { method: "GET" });
  }

  function approveDaoEngineer(engineerId, note) {
    return http("/api/dao-demo/approve", { method: "POST", body: { engineerId, note } });
  }

  function rejectDaoEngineer(engineerId, note) {
    return http("/api/dao-demo/reject", { method: "POST", body: { engineerId, note } });
  }

  // -------------------- Client pools (FM sourcing) --------------------
  function getClientSourcing() {
    return http("/api/client-sourcing", { method: "GET" });
  }

  function updateMatchingPolicy(patch) {
    return http("/api/client-sourcing/policy", { method: "PATCH", body: patch || {} });
  }

  function favouriteEngineer(engineerId) {
    return http("/api/client-sourcing/favourites", { method: "POST", body: { engineerId } });
  }

  function unfavouriteEngineer(engineerId) {
    return http("/api/client-sourcing/favourites", { method: "DELETE", body: { engineerId } });
  }

  function createEngineerPool(name) {
    return http("/api/client-sourcing/pools", { method: "POST", body: { name } });
  }

  function renameEngineerPool(poolId, name) {
    return http(`/api/client-sourcing/pools/${encodeURIComponent(poolId)}`, {
      method: "PATCH",
      body: { name },
    });
  }

  function deleteEngineerPool(poolId) {
    return http(`/api/client-sourcing/pools/${encodeURIComponent(poolId)}`, { method: "DELETE" });
  }

  function addEngineerToPool(poolId, engineerId) {
    return http(`/api/client-sourcing/pools/${encodeURIComponent(poolId)}/engineers`, {
      method: "POST",
      body: { engineerId },
    });
  }

  function removeEngineerFromPool(poolId, engineerId) {
    return http(`/api/client-sourcing/pools/${encodeURIComponent(poolId)}/engineers`, {
      method: "DELETE",
      body: { engineerId },
    });
  }

  function addInhouseEngineer(engineer) {
    return http("/api/client-sourcing/inhouse", { method: "POST", body: engineer || {} });
  }

  function updateInhouseEngineer(engineerId, patch) {
    return http(`/api/client-sourcing/inhouse/${encodeURIComponent(engineerId)}`, {
      method: "PATCH",
      body: patch || {},
    });
  }

  function removeInhouseEngineer(engineerId) {
    return http(`/api/client-sourcing/inhouse/${encodeURIComponent(engineerId)}`, {
      method: "DELETE",
    });
  }

  function listMarketplaceEngineers() {
    return http("/api/client-sourcing/marketplace", { method: "GET" });
  }

  // -------------------- Tickets --------------------
  function createDemoTicket(payload) {
    return http("/api/tickets", { method: "POST", body: payload || {} });
  }

  function getClientTickets() {
    return http("/api/tickets", { method: "GET" });
  }

  function updateTicketStatus(ticketId, status, patch = {}) {
    return http(`/api/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: "PATCH",
      body: { status, ...patch },
    });
  }

  // -------------------- Tasks --------------------
  function getTasks() {
    return http("/api/tasks", { method: "GET" });
  }

  function acceptTask(taskId) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/accept`, { method: "POST" });
  }

  function declineTask(taskId) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/decline`, { method: "POST" });
  }

  function startTravel(taskId) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/travel`, { method: "POST" });
  }

  function arriveOnSite(taskId) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/arrive`, { method: "POST" });
  }

  function requestComplete(taskId, meta) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/request-complete`, {
      method: "POST",
      body: meta || {},
    });
  }

  function submitEvidence(taskId, evidence) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/evidence`, {
      method: "POST",
      body: evidence || {},
    });
  }

  function completeTask(taskId, costBreakdown) {
    return http(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
      method: "POST",
      body: costBreakdown || {},
    });
  }

  function getTaskHistory() {
    return http("/api/tasks/history", { method: "GET" });
  }

  function getTaskHistorySummary() {
    return http("/api/tasks/history/summary", { method: "GET" });
  }

  // -------------------- Reminders --------------------
  function addReminderForTask(taskId, whenISO, note) {
    return http("/api/reminders", { method: "POST", body: { taskId, whenISO, note } });
  }

  function listReminders() {
    return http("/api/reminders", { method: "GET" });
  }

  // -------------------- Escrow --------------------
  function getEscrowStatus() {
    return http("/api/payments/escrow/status", { method: "GET" });
  }

  function escrowDeposit(payload) {
    return http("/api/payments/escrow/deposit", { method: "POST", body: payload || {} });
  }

  function escrowRelease(payload) {
    return http("/api/payments/escrow/release", { method: "POST", body: payload || {} });
  }

  function escrowRefund(payload) {
    return http("/api/payments/escrow/refund", { method: "POST", body: payload || {} });
  }

  function listEscrowLedger() {
    return http("/api/payments/escrow/ledger", { method: "GET" });
  }

  // -------------------- Assets --------------------
  function getAssets() {
    return http("/api/assets", { method: "GET" });
  }

  function createAsset(asset) {
    return http("/api/assets", { method: "POST", body: asset || {} });
  }

  function updateAsset(assetId, patch) {
    return http(`/api/assets/${encodeURIComponent(assetId)}`, { method: "PATCH", body: patch || {} });
  }

  function deleteAsset(assetId) {
    return http(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  }

  // -------------------- PLC --------------------
  function getPlcAlerts() {
    return http("/api/plc/alerts", { method: "GET" });
  }

  function createTestPlcAlert(payload) {
    return http("/api/plc/alerts/test", { method: "POST", body: payload || {} });
  }

  // -------------------- Partner API access (admin UI / demo) --------------------
  function getPartnerAccess() {
    return http("/api/partner/access", { method: "GET" });
  }

  function createApiKey(payload) {
    return http("/api/partner/keys", { method: "POST", body: payload || {} });
  }

  function rotateSecret(keyId) {
    return http(`/api/partner/keys/${encodeURIComponent(keyId)}/rotate`, { method: "POST" });
  }

  function revokeKey(keyId) {
    return http(`/api/partner/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
  }

  function listApiKeys() {
    return http("/api/partner/keys", { method: "GET" });
  }

  function getAuditLog() {
    return http("/api/partner/audit", { method: "GET" });
  }

  function verifyRequest(payload) {
    return http("/api/partner/verify", { method: "POST", body: payload || {} });
  }

  function simulateApiCall(payload) {
    return http("/api/partner/simulate", { method: "POST", body: payload || {} });
  }

  // -------------------- Public API --------------------
  const API = {
    configure(next = {}) {
      Object.assign(cfg, next || {});
      return { ...cfg };
    },

    // socket
    getWidgetSocket,

    // analytics
    track,
    startFeature,
    endFeature,
    getDemoAnalyticsSummary,

    // role
    getRole,
    setRole,
    setEngineerId,

    // demographics
    getDemographics,
    setDemographics,

    // engineer profile
    getEngineerProfile,
    saveEngineerProfile,
    addCertification,
    addDBS,
    addInsurance,

    // DAO
    getDAOStatus,
    submitProfileToDAO,
    resubmitDAO,
    getDaoQueue,
    approveDaoEngineer,
    rejectDaoEngineer,

    // client pools
    getClientSourcing,
    updateMatchingPolicy,
    favouriteEngineer,
    unfavouriteEngineer,
    createEngineerPool,
    renameEngineerPool,
    deleteEngineerPool,
    addEngineerToPool,
    removeEngineerFromPool,
    addInhouseEngineer,
    updateInhouseEngineer,
    removeInhouseEngineer,
    listMarketplaceEngineers,

    // tickets
    createDemoTicket,
    getClientTickets,
    updateTicketStatus,

    // tasks
    getTasks,
    acceptTask,
    declineTask,
    startTravel,
    arriveOnSite,
    requestComplete,
    submitEvidence,
    completeTask,
    getTaskHistory,
    getTaskHistorySummary,

    // reminders
    addReminderForTask,
    listReminders,

    // escrow
    getEscrowStatus,
    escrowDeposit,
    escrowRelease,
    escrowRefund,
    listEscrowLedger,

    // assets / plc
    getAssets,
    createAsset,
    updateAsset,
    deleteAsset,
    getPlcAlerts,
    createTestPlcAlert,

    // partner api access
    getPartnerAccess,
    createApiKey,
    rotateSecret,
    revokeKey,
    listApiKeys,
    getAuditLog,
    verifyRequest,
    simulateApiCall,
  };

  window.notfallGateway = { API };
})();

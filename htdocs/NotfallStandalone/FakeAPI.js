// FakeAPI.js
// Thin wrapper around your real notfall-demo/api backend.
// Keeps the same front-end surface (getEngineerProfile, getTasks, etc)
// but internally uses fetch() and sends x-demo-role for sandbox roles.

const API_BASE =
  (typeof window !== "undefined" && window.__NOTFALL_API_BASE) ||
  "http://localhost:5007/api";

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function http(path, { method = "GET", body, headers = {} } = {}, role, sessionToken) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const finalHeaders = {
    ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    "x-demo-role": role || "ENGINEER", // ENGINEER | CLIENT | DAO_ADMIN
    ...(sessionToken ? { "x-demo-session": sessionToken } : {}),
    ...headers
  };

  const opts = {
    method,
    headers: finalHeaders
  };

  if (body) {
    opts.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error) ||
      res.statusText ||
      "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

// ---------------------------------------------------------------------
// FakeAPI core
// ---------------------------------------------------------------------

const FakeAPI = {
  // ---------------------------------------------------------------
  // Demo session / role management
  // ---------------------------------------------------------------
  _role: "ENGINEER", // ENGINEER | CLIENT | DAO_ADMIN
  _sessionToken: null,

  setRole(role) {
    const allowed = ["ENGINEER", "CLIENT", "DAO_ADMIN"];
    if (!allowed.includes(role)) {
      console.warn("FakeAPI.setRole: invalid role", role, "– defaulting to ENGINEER");
      this._role = "ENGINEER";
    } else {
      this._role = role;
    }
  },

  getRole() {
    return this._role;
  },

  setSessionToken(token) {
    this._sessionToken = token;
  },

  // ---------------------------------------------------------------
  // ENGINEER profile / DAO
  // ---------------------------------------------------------------

  /**
   * Load the engineer profile for the current demo session.
   * GET /api/engineer/profile
   */
  async getEngineerProfile() {
    const data = await http(
      "/engineer/profile",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    // Ensure the front-end always receives a sane shape
    return {
      fullName: "",
      phone: "",
      primaryTrade: "",
      certifications: "",
      walletAddress: "",
      insurancePolicy: "",
      country: "",
      city: "",
      language: "",
      hourlyRate: "",
      ...data
    };
  },

  /**
   * Save profile (JSON only in demo).
   * PUT /api/engineer/profile
   */
  async saveEngineerProfile(payload) {
    const data = await http(
      "/engineer/profile",
      {
        method: "PUT",
        body: payload
      },
      this._role,
      this._sessionToken
    );
    return data;
  },

  /**
   * Submit profile to DAO for certification.
   * POST /api/engineer/dao/submit
   */
  async submitProfileToDAO() {
    const data = await http(
      "/engineer/dao/submit",
      { method: "POST" },
      this._role,
      this._sessionToken
    );
    return data;
  },

  /**
   * DAO status for this engineer.
   * GET /api/engineer/dao/status
   *
   * Expected shape:
   * { status, submittedAt, reviewedAt, reviewer, note }
   */
  async getDAOStatus() {
    const data = await http(
      "/engineer/dao/status",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return {
      status: "NOT_SUBMITTED",
      submittedAt: null,
      reviewedAt: null,
      reviewer: null,
      note: "",
      ...data
    };
  },

  /**
   * Resubmit after rejection (optional).
   * POST /api/engineer/dao/resubmit
   */
  async resubmitDAO() {
    const data = await http(
      "/engineer/dao/resubmit",
      { method: "POST" },
      this._role,
      this._sessionToken
    );
    return data;
  },

  // ---------------------------------------------------------------
  // ENGINEER tasks / lifecycle
  // ---------------------------------------------------------------

  /**
   * Fetch tasks in the engineer inbox.
   * GET /api/engineer/tasks
   *
   * Expected shape: [ { id, title, site, status, priority, ... } ]
   */
  async getTasks() {
    const data = await http(
      "/engineer/tasks",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return Array.isArray(data) ? data : [];
  },

  /**
   * Accept a task.
   * POST /api/engineer/tasks/:id/accept
   */
  async acceptTask(taskId) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/accept`,
      { method: "POST" },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Decline a task.
   * POST /api/engineer/tasks/:id/decline
   */
  async declineTask(taskId) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/decline`,
      { method: "POST" },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Start travel.
   * POST /api/engineer/tasks/:id/start-travel
   */
  async startTravel(taskId) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/start-travel`,
      { method: "POST" },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Arrive on site.
   * POST /api/engineer/tasks/:id/arrive-on-site
   */
  async arriveOnSite(taskId) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/arrive-on-site`,
      { method: "POST" },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Complete a task (after RAMS + evidence).
   * POST /api/engineer/tasks/:id/complete
   */
  async completeTask(taskId) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/complete`,
      { method: "POST" },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Save RAMS checklist for a task.
   * POST /api/engineer/tasks/:id/rams
   *
   * Payload example:
   * { status: "OK", riskAssessed: true, ppeChecked: true, isolationConfirmed: true }
   */
  async saveTaskRams(taskId, ramsPayload) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/rams`,
      {
        method: "POST",
        body: ramsPayload
      },
      this._role,
      this._sessionToken
    );
  },

  /**
   * Save evidence metadata (demo – filenames only).
   * POST /api/engineer/tasks/:id/evidence
   *
   * Payload example:
   * { status: "UPLOADED", beforePhotoName, afterPhotoName, notes }
   *
   * NOTE: In demo we ONLY send metadata (no real file upload).
   * Real file upload would be multipart/form-data to a different route.
   */
  async saveTaskEvidence(taskId, evidencePayload) {
    return http(
      `/engineer/tasks/${encodeURIComponent(taskId)}/evidence`,
      {
        method: "POST",
        body: evidencePayload
      },
      this._role,
      this._sessionToken
    );
  },

  // ---------------------------------------------------------------
  // Task stream (live queue) – SSE with graceful fallback
  // ---------------------------------------------------------------

  /**
   * Subscribe to live task stream.
   *
   * Backend option A (preferred in future):
   *   SSE on GET /api/engineer/tasks/stream
   *
   * For now:
   *  - Try EventSource (SSE) if the server supports it
   *  - If not available, just mark stream as idle (existing UI still works)
   *
   * Listener receives objects shaped like:
   *   { type: "STREAM_ON" | "STREAM_IDLE" | "NEW_TASK", task?: {...} }
   */
  subscribeTaskStream(listener) {
    // If EventSource isn’t available, just emit idle + return noop
    if (typeof EventSource === "undefined") {
      listener({ type: "STREAM_IDLE" });
      return () => {};
    }

    const url = `${API_BASE}/engineer/tasks/stream?role=${encodeURIComponent(
      this._role
    )}`;

    const es = new EventSource(url);

    es.addEventListener("open", () => {
      listener({ type: "STREAM_ON" });
    });

    es.addEventListener("error", () => {
      listener({ type: "STREAM_IDLE" });
    });

    es.addEventListener("message", (evt) => {
      try {
        const payload = JSON.parse(evt.data);
        if (payload.type === "NEW_TASK" && payload.task) {
          listener({
            type: "NEW_TASK",
            task: payload.task
          });
        } else if (payload.type) {
          listener(payload);
        }
      } catch {
        // ignore parse errors in demo
      }
    });

    // Return unsubscribe
    return () => {
      try {
        es.close();
      } catch {
        // ignore
      }
    };
  },

  // ---------------------------------------------------------------
  // Job Wallets (Earnings → Job Wallets tab)
  // ---------------------------------------------------------------

  /**
   * List Job Wallets for the engineer.
   * GET /api/engineer/job-wallets
   *
   * Expected shape:
   * [
   *   {
   *     taskId,
   *     title,
   *     amount,
   *     currency,
   *     provider,
   *     rate,
   *     slaHours,
   *     etaMinutes,
   *     createdAt,
   *     pan,
   *     last4,
   *     validThru,
   *     cvv
   *   }
   * ]
   */
  async getJobWallets() {
    const data = await http(
      "/engineer/job-wallets",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return Array.isArray(data) ? data : [];
  },

  // ---------------------------------------------------------------
  // Layout prefs (if you use /api/user/layout from React version)
  // ---------------------------------------------------------------

  /**
   * Get layout preferences for current demo user/role.
   * GET /api/user/layout
   */
  async getLayoutPrefs() {
    const data = await http(
      "/user/layout",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return data;
  },

  /**
   * Save layout preferences.
   * PUT /api/user/layout
   */
  async saveLayoutPrefs(instances) {
    const data = await http(
      "/user/layout",
      {
        method: "PUT",
        body: { instances }
      },
      this._role,
      this._sessionToken
    );
    return data;
  },

  // ---------------------------------------------------------------
  // CLIENT role – tickets (for future use)
  // ---------------------------------------------------------------

  /**
   * Client: raise a ticket (used by client dashboard).
   * POST /api/client/tickets
   *
   * payload: { title, site, description, priority, trade, depositGBP }
   */
  async clientCreateTicket(payload) {
    const data = await http(
      "/client/tickets",
      {
        method: "POST",
        body: payload
      },
      this._role,
      this._sessionToken
    );
    return data;
  },

  /**
   * Client: list tickets.
   * GET /api/client/tickets
   */
  async clientGetTickets() {
    const data = await http(
      "/client/tickets",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return Array.isArray(data) ? data : [];
  },

  // ---------------------------------------------------------------
  // DAO_ADMIN role – certification queue (for future use)
  // ---------------------------------------------------------------

  /**
   * DAO admin: list certifications awaiting review.
   * GET /api/admin/dao/queue
   */
  async adminGetDaoQueue() {
    const data = await http(
      "/admin/dao/queue",
      { method: "GET" },
      this._role,
      this._sessionToken
    );
    return Array.isArray(data) ? data : [];
  },

  /**
   * DAO admin: approve or reject an engineer.
   * POST /api/admin/dao/decide
   * body: { engineerId, decision: "APPROVE" | "REJECT", note }
   */
  async adminDecideDao(payload) {
    const data = await http(
      "/admin/dao/decide",
      {
        method: "POST",
        body: payload
      },
      this._role,
      this._sessionToken
    );
    return data;
  }
};

// Make available globally in the browser
if (typeof window !== "undefined") {
  window.FakeAPI = FakeAPI;
}

// Support ES module import as well
export default FakeAPI;

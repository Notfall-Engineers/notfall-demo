/* htdocs/demo/FakeAPI.js
   Notfall Engineers – Demo FakeAPI + Live Bridge

   Core upgrades:
   Stronger persistence + WS sync so widgets update after refresh
   Ticket ↔ Task ↔ Escrow lifecycle syncing
   Task history with average completion time KPIs
   Evidence-gated completion (before/after proof required)
   Editable Asset Registry
   Partner API Access: keys/scopes/env/rate-limit/audit/verify
      Client Engineer Pools:
      - favourites
      - custom pools (from Notfall marketplace engineers)
      - in-house team (not DAO certified by default)
      - policy toggles to influence candidate selection

   Public: window.FakeAPI with:
     getWidgetSocket()  -> shared socket (demo bus or real WS)
     getRole/setRole
     analytics: track/startFeature/endFeature/getDemoAnalyticsSummary
     demographics: getDemographics/setDemographics
     engineer profile: getEngineerProfile/saveEngineerProfile/setEngineerId
     DAO: getDAOStatus/submitProfileToDAO/resubmitDAO/getDaoQueue/approveDaoEngineer/rejectDaoEngineer
          + addCertification/addDBS/addInsurance (demo helpers)
     tickets: createDemoTicket/getClientTickets/updateTicketStatus
     tasks: getTasks/acceptTask/declineTask/startTravel/arriveOnSite/requestComplete/submitEvidence/completeTask
           + getTaskHistory/getTaskHistorySummary
     escrow: getEscrowStatus/escrowDeposit/escrowRelease/escrowRefund/listEscrowLedger
     assets/plc: getAssets/createAsset/updateAsset/deleteAsset/getPlcAlerts/createTestPlcAlert
     partner api: getPartnerAccess/createApiKey/rotateSecret/revokeKey/listApiKeys/getAuditLog/verifyRequest/simulateApiCall
      client pools:
        getClientSourcing/updateMatchingPolicy
        favouriteEngineer/unfavouriteEngineer
        createEngineerPool/renameEngineerPool/deleteEngineerPool
        addEngineerToPool/removeEngineerFromPool
        addInhouseEngineer/updateInhouseEngineer/removeInhouseEngineer
        listMarketplaceEngineers (Notfall pool reference list)

   Message shapes emitted:
     { topic:"demographics", action:"updated", payload:{...} }
     { topic:"profile", action:"saved", payload:{...} }
     { topic:"dao", action:"submitted|approved|rejected|updated", payload:{...} }
     { topic:"ticket", action:"created|updated", payload:{...} }
     { topic:"task", action:"offer|update|history", payload:{...} }
     { type:"escrow:update", status:{...}, ledgerEntry:{...} }
     { topic:"plcAlert", action:"created", payload:{...} }
     { topic:"assetRegistry", action:"updated|deleted", payload:{...} }
     { topic:"partnerApi", action:"keyCreated|keyRevoked|keyRotated|audit|call", payload:{...} }
     { topic:"client", action:"favouriteAdded|favouriteRemoved|poolCreated|poolUpdated|poolDeleted|inhouseAdded|inhouseUpdated|inhouseRemoved|policyUpdated", payload:{...} }
*/

(() => {
  // ---------------------------- Config ----------------------------
  const DEFAULTS = {
    liveMode: false,
    apiBase: "http://localhost:8080",
    wsUrl: "ws://localhost:8080/ws/widgets",
    storageKey: "nf_demo_state_v5",
    analyticsKey: "nf_demo_analytics_v5",
    featureKey: "nf_demo_features_v5",
    demographicsKey: "nf_demo_demographics_v5",
    partnerKey: "nf_demo_partner_access_v2"
  };

  const cfg = { ...DEFAULTS };

  // ---------------------------- Helpers ----------------------------
  const nowISO = () => new Date().toISOString();
  const uuid = () =>
    (window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeParse(raw, fallback) {
    try {
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function clampMoney(n) {
    const x = Number(n || 0);
    return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
  }

  function isCriticalPriority(p) {
    const v = String(p || "").toUpperCase();
    return v === "CRITICAL" || v === "HARDSTOP";
  }

  function uniqueKeepOrder(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr || []) {
      const k = String(x || "").trim();
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }

  // ---------------------------- Client Pools Helpers ----------------------------
  function ensureClient(st) {
    st.client = st.client || {
      clientId: st.role?.clientId || "client_demo",

      favouriteEngineerIds: [],
      pools: [], // { poolId, name, engineerIds:[], createdAt, updatedAt }
      inhouseTeam: [], // { engineerId, fullName, tradePrimary, phone, email, isDaoCertified:false, createdAt, updatedAt }

      matchingPolicy: {
        preferFavourites: true,
        preferPools: true,
        allowInhouse: true,
        requireDaoCertificationForAutoDispatch: true
      },

      updatedAt: nowISO()
    };
  }

  function ensureMarketplace(st) {
    // Reference marketplace engineer pool (Notfall network)
    // In demo: small, stable list. In live mode you would fetch this from backend.
    st.marketplaceEngineers = st.marketplaceEngineers || [
      {
        engineerId: "eng_demo",
        fullName: "Demo Engineer",
        tradePrimary: "HVAC",
        rating: 4.8,
        etaMins: 18,
        daoStatus: "APPROVED_CERTIFIED"
      },
      {
        engineerId: "eng_hvac_02",
        fullName: "A. Patel",
        tradePrimary: "HVAC",
        rating: 4.7,
        etaMins: 22,
        daoStatus: "APPROVED_CERTIFIED"
      },
      {
        engineerId: "eng_elec_01",
        fullName: "S. Okoye",
        tradePrimary: "Electrical",
        rating: 4.9,
        etaMins: 28,
        daoStatus: "APPROVED_CERTIFIED"
      },
      {
        engineerId: "eng_plumb_01",
        fullName: "M. Hughes",
        tradePrimary: "Plumbing",
        rating: 4.6,
        etaMins: 35,
        daoStatus: "PENDING"
      },
      {
        engineerId: "eng_plc_01",
        fullName: "J. Novak",
        tradePrimary: "Industrial / PLC",
        rating: 4.8,
        etaMins: 26,
        daoStatus: "APPROVED_CERTIFIED"
      }
    ];
  }

  function getDaoStatusForEngineer(st, engineerId) {
    const eid = String(engineerId || "").trim();
    if (!eid) return "NOT_SUBMITTED";

    // Prefer DAO map (authoritative in demo)
    const s = st.dao?.statusByEngineerId?.[eid]?.status;
    if (s) return s;

    // Fallback to marketplace list value
    const m = (st.marketplaceEngineers || []).find((x) => x.engineerId === eid);
    if (m?.daoStatus) return m.daoStatus;

    // Fallback: in-house records
    const ih = (st.client?.inhouseTeam || []).find((x) => x.engineerId === eid);
    if (ih) return ih.isDaoCertified ? "APPROVED_CERTIFIED" : "NOT_SUBMITTED";

    return "NOT_SUBMITTED";
  }

  function isDaoCertifiedStatus(status) {
    return String(status || "") === "APPROVED_CERTIFIED";
  }

  function pickCandidatesForTicket(st, ticket) {
    ensureClient(st);
    ensureMarketplace(st);

    const trade = String(ticket.trade || "").trim();
    const urgent = isCriticalPriority(ticket.priority);
    const policy = st.client.matchingPolicy || {};

    const marketplace = (st.marketplaceEngineers || [])
      .filter((e) => {
        if (!trade) return true;
        return String(e.tradePrimary || "").toLowerCase().includes(trade.toLowerCase());
      })
      .map((e) => e.engineerId);

    const favs = uniqueKeepOrder(st.client.favouriteEngineerIds || []);
    const poolIds = (st.client.pools || []).flatMap((p) => p.engineerIds || []);
    const pools = uniqueKeepOrder(poolIds);

    const inhouse = uniqueKeepOrder((st.client.inhouseTeam || []).map((x) => x.engineerId));

    let ordered = [];
    if (policy.preferFavourites) ordered = ordered.concat(favs);
    if (policy.preferPools) ordered = ordered.concat(pools);

    // Always include DAO marketplace pool to ensure there is a network fallback
    ordered = ordered.concat(marketplace);

    if (policy.allowInhouse) ordered = ordered.concat(inhouse);
    ordered = uniqueKeepOrder(ordered);

    // Urgent auto-dispatch constraint: keep only DAO-certified candidates if toggled
    if (urgent && policy.requireDaoCertificationForAutoDispatch) {
      ordered = ordered.filter((eid) => isDaoCertifiedStatus(getDaoStatusForEngineer(st, eid)));
    }

    // Ensure we have at least someone
    if (!ordered.length) ordered = marketplace.slice(0, 3);

    return ordered.slice(0, 8);
  }

  // ---------------------------- Persistence ----------------------------
  function loadState() {
    const s = safeParse(localStorage.getItem(cfg.storageKey), null);
    if (s) return s;

    const initial = {
      role: { role: "ENGINEER", engineerId: "eng_demo", clientId: "client_demo" },

      engineerProfile: {
        engineerId: "eng_demo",
        fullName: "Demo Engineer",
        country: "United Kingdom",
        language: "English (UK)",
        hourlyRateGBP: 65,
        tradePrimary: "HVAC",
        phone: "",
        email: "",
        bio: "Emergency response engineer (demo).",
        certs: [],
        dbs: null,
        insurance: null,
        profilePhotoDataUrl: ""
      },

      dao: {
        statusByEngineerId: {
          eng_demo: {
            status: "NOT_SUBMITTED",
            note: "Submit your profile for DAO review.",
            updatedAt: nowISO()
          }
        },
        queue: []
      },

      // client pools (FM/client sourcing)
      client: {
        clientId: "client_demo",
        favouriteEngineerIds: [],
        pools: [],
        inhouseTeam: [],
        matchingPolicy: {
          preferFavourites: true,
          preferPools: true,
          allowInhouse: true,
          requireDaoCertificationForAutoDispatch: true
        },
        updatedAt: nowISO()
      },

      // marketplace reference list
      marketplaceEngineers: null,

      escrow: {
        provider: "Revolut Business",
        accountName: "Notfall Engineers - Escrow (Operational)",
        currency: "GBP",
        ibanMasked: "GB** **** **** **** 1234",
        refPrefix: "NF-ESCROW",
        heldInEscrowGBP: 0,
        releasedGBP: 0,
        refundedGBP: 0,
        updatedAt: nowISO(),
        ledger: []
      },

      tickets: [],
      tasks: [],
      taskHistory: [],
      reminders: [],

      assets: [],
      plcAlerts: []
    };

    ensureMarketplace(initial);
    localStorage.setItem(cfg.storageKey, JSON.stringify(initial));
    return initial;
  }

  function saveState(s) {
    localStorage.setItem(cfg.storageKey, JSON.stringify(s));
  }

  function loadDemographics() {
    return safeParse(localStorage.getItem(cfg.demographicsKey), null);
  }

  function saveDemographics(d) {
    localStorage.setItem(cfg.demographicsKey, JSON.stringify(d));
  }

  // (continued in Part 2)
  // ---------------------------- Analytics ----------------------------
  function loadAnalytics() {
    return safeParse(localStorage.getItem(cfg.analyticsKey), {
      events: [],
      counters: {},
      sessionStartedAt: nowISO()
    });
  }
  function saveAnalytics(a) {
    localStorage.setItem(cfg.analyticsKey, JSON.stringify(a));
  }

  function loadFeatureTimers() {
    return safeParse(localStorage.getItem(cfg.featureKey), {
      active: {},
      stats: {}
    });
  }
  function saveFeatureTimers(x) {
    localStorage.setItem(cfg.featureKey, JSON.stringify(x));
  }

  function track(eventName, meta = {}) {
    const a = loadAnalytics();
    const evt = { id: uuid(), at: nowISO(), event: eventName, meta };
    a.events.unshift(evt);
    a.events = a.events.slice(0, 800);
    a.counters[eventName] = (a.counters[eventName] || 0) + 1;
    saveAnalytics(a);
    return evt;
  }

  function startFeature(feature) {
    const ft = loadFeatureTimers();
    ft.active[feature] = nowISO();
    ft.stats[feature] = ft.stats[feature] || { totalMs: 0, opens: 0 };
    ft.stats[feature].opens += 1;
    saveFeatureTimers(ft);
  }

  function endFeature(feature) {
    const ft = loadFeatureTimers();
    const startedAt = ft.active[feature];
    if (!startedAt) return;
    const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
    ft.stats[feature] = ft.stats[feature] || { totalMs: 0, opens: 0 };
    ft.stats[feature].totalMs += ms;
    delete ft.active[feature];
    saveFeatureTimers(ft);
  }

  async function getDemoAnalyticsSummary() {
    const a = loadAnalytics();
    const ft = loadFeatureTimers();
    const sessionMins = Math.max(
      1,
      Math.round((Date.now() - new Date(a.sessionStartedAt).getTime()) / 60000)
    );

    const features = Object.entries(ft.stats || {}).map(([feature, v]) => ({
      feature,
      mins: Math.max(0, Math.round((v.totalMs || 0) / 60000)),
      opens: v.opens || 0
    }));
    features.sort((x, y) => (y.mins - x.mins) || (y.opens - x.opens));

    const topEvents = Object.entries(a.counters || {})
      .map(([event, count]) => ({ event, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 12);

    const topWidget =
      (topEvents.find((x) => String(x.event).startsWith("widget_")) || {}).event || "—";

    return {
      sessionMins,
      totalEvents: a.events.length,
      topWidget: topWidget === "—" ? "—" : topWidget.replace("widget_", ""),
      topWidgetMins: features[0]?.mins || 0,
      features,
      topEvents
    };
  }

  // ---------------------------- Demo Socket Bus (WebSocket-like) ----------------------------
  class DemoSocket {
    constructor() {
      this.readyState = 1;
      this._listeners = new Map();
      this._subs = new Set();
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    }
    _emit(type, data) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) {
        try {
          fn({ data });
        } catch {}
      }
    }
    send(raw) {
      let msg = null;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg?.type === "subscribe") {
        const topics = msg.topics || (msg.topic ? [msg.topic] : []);
        topics.forEach((t) => this._subs.add(String(t).toLowerCase()));
        return;
      }

      if (msg?.type === "ping" && msg.t) {
        this._emit("message", JSON.stringify({ type: "pong", t: msg.t }));
        return;
      }

      if (msg?.topic === "analytics") {
        track(msg.event_name || "analytics_event", msg);
      }
    }
    close() {
      this.readyState = 3;
      this._listeners.clear();
    }
  }

  // ---------------------------- Live WS Wrapper ----------------------------
  function makeRealWsUrl(roleInfo) {
    const role = encodeURIComponent(roleInfo?.role || "ENGINEER");
    const engineerId = encodeURIComponent(roleInfo?.engineerId || "");
    const clientId = encodeURIComponent(roleInfo?.clientId || "");
    const qs = `?role=${role}&engineerId=${engineerId}&clientId=${clientId}`;
    return `${cfg.wsUrl}${qs}`;
  }

  let sharedSocket = null;
  let sharedSocketMode = "demo";
  let liveWs = null;

  function getSharedSocket() {
    const st = loadState();

    if (cfg.liveMode) {
      if (sharedSocket && sharedSocketMode === "live") return sharedSocket;

      try {
        const url = makeRealWsUrl(st.role);
        liveWs = new WebSocket(url);
        sharedSocket = liveWs;
        sharedSocketMode = "live";

        liveWs.onclose = () => {
          sharedSocket = new DemoSocket();
          sharedSocketMode = "demo";
        };
        liveWs.onerror = () => {
          try { liveWs.close(); } catch {}
        };

        return sharedSocket;
      } catch {
        sharedSocket = new DemoSocket();
        sharedSocketMode = "demo";
        return sharedSocket;
      }
    }

    if (!sharedSocket) {
      sharedSocket = new DemoSocket();
      sharedSocketMode = "demo";
    }
    return sharedSocket;
  }

  function emitWs(obj) {
    const ws = getSharedSocket();
    const payload = JSON.stringify(obj);

    if (ws instanceof DemoSocket) {
      ws._emit("message", payload);
      return;
    }

    try { ws.send(payload); } catch {}
  }

  // ---------------------------- Live REST fetch (optional) ----------------------------
  async function liveFetch(path, opts = {}) {
    const res = await fetch(`${cfg.apiBase}${path}`, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new Error(json?.error || json?.message || `Request failed (${res.status})`);
    return json;
  }

  // ---------------------------- Role ----------------------------
  async function getRole() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/demo/role", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return st.role;
  }

  async function setRole(roleStr) {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/demo/role", {
          method: "POST",
          body: JSON.stringify({ role: roleStr })
        });
        const st = loadState();
        st.role = r || { role: roleStr };
        saveState(st);
        track("role_set_live", { role: roleStr });
        return r;
      } catch {}
    }

    const st = loadState();
    st.role.role = roleStr;
    if (!st.role.engineerId) st.role.engineerId = "eng_demo";
    if (!st.role.clientId) st.role.clientId = "client_demo";
    saveState(st);

    track("role_set_demo", { role: roleStr });
    emitWs({ topic: "role", action: "updated", payload: st.role });
    return st.role;
  }

  function setEngineerId(engineerId) {
    const st = loadState();
    st.role.engineerId = engineerId || "eng_demo";
    st.engineerProfile.engineerId = st.role.engineerId;
    saveState(st);

    track("engineer_id_set", { engineerId: st.role.engineerId });
    emitWs({ topic: "role", action: "updated", payload: st.role });
  }

  // ---------------------------- Demographics (Persist + WS) ----------------------------
  async function getDemographics() {
    return loadDemographics();
  }

  async function setDemographics(d) {
    saveDemographics(d || null);
    track("demographics_saved", { hasProfile: !!d });
    emitWs({ topic: "demographics", action: "updated", payload: d || null });
    return d;
  }

  // ---------------------------- Engineer Profile (Persist + WS) ----------------------------
  async function getEngineerProfile() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/engineer/profile", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return st.engineerProfile;
  }

  async function saveEngineerProfile(profile) {
    if (cfg.liveMode) {
      try {
        const p = await liveFetch("/api/engineer/profile", {
          method: "POST",
          body: JSON.stringify(profile)
        });
        track("profile_saved_live", { engineerId: profile?.engineerId });
        return p;
      } catch {}
    }

    const st = loadState();
    st.engineerProfile = { ...st.engineerProfile, ...(profile || {}) };
    if (st.engineerProfile.engineerId) st.role.engineerId = st.engineerProfile.engineerId;

    // keep DAO queue snapshot in sync if present
    const eid = st.engineerProfile.engineerId || "eng_demo";
    const qi = st.dao.queue.findIndex((x) => x.engineerId === eid);
    if (qi >= 0) st.dao.queue[qi] = { ...st.dao.queue[qi], ...st.engineerProfile };

    saveState(st);
    track("profile_saved_demo", { engineerId: st.engineerProfile.engineerId });
    emitWs({ topic: "profile", action: "saved", payload: st.engineerProfile });
    return st.engineerProfile;
  }

  // Demo helpers (for buttons: “+ Add certification/DBS/insurance”)
  async function addCertification(cert) {
    const st = loadState();
    st.engineerProfile.certs = Array.isArray(st.engineerProfile.certs) ? st.engineerProfile.certs : [];
    st.engineerProfile.certs.unshift({
      id: uuid(),
      title: cert?.title || "F-Gas / HVAC Certification (Demo)",
      issuer: cert?.issuer || "Accredited Body",
      expiresAt: cert?.expiresAt || new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
      uploadedAt: nowISO()
    });
    saveState(st);
    emitWs({ topic: "profile", action: "saved", payload: st.engineerProfile });
    track("profile_add_cert_demo", {});
    return st.engineerProfile;
  }

  async function addDBS(dbs) {
    const st = loadState();
    st.engineerProfile.dbs = {
      level: dbs?.level || "Enhanced",
      reference: dbs?.reference || `DBS-${String(uuid()).slice(0, 8).toUpperCase()}`,
      issuedAt: dbs?.issuedAt || nowISO(),
      uploadedAt: nowISO()
    };
    saveState(st);
    emitWs({ topic: "profile", action: "saved", payload: st.engineerProfile });
    track("profile_add_dbs_demo", {});
    return st.engineerProfile;
  }

  async function addInsurance(ins) {
    const st = loadState();
    st.engineerProfile.insurance = {
      provider: ins?.provider || "Demo Insurer Ltd",
      policyNo: ins?.policyNo || `POL-${String(uuid()).slice(0, 8).toUpperCase()}`,
      coverGBP: clampMoney(ins?.coverGBP || 2000000),
      expiresAt: ins?.expiresAt || new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(),
      uploadedAt: nowISO()
    };
    saveState(st);
    emitWs({ topic: "profile", action: "saved", payload: st.engineerProfile });
    track("profile_add_insurance_demo", {});
    return st.engineerProfile;
  }

  // ---------------------------- DAO (Real-time status updates) ----------------------------
  async function getDAOStatus() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/dao/status", { method: "GET" }); } catch {}
    }
    const s = loadState();
    const eid = s.role.engineerId || "eng_demo";
    return (
      s.dao.statusByEngineerId[eid] || {
        status: "NOT_SUBMITTED",
        note: "Submit profile.",
        updatedAt: nowISO()
      }
    );
  }

  async function submitProfileToDAO() {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/dao/submit", { method: "POST" });
        track("dao_submit_live", r);
        return r;
      } catch {}
    }

    const st = loadState();
    const p = st.engineerProfile;
    const eid = p.engineerId || "eng_demo";

    const hasInsurance = !!p.insurance;
    const hasCerts = Array.isArray(p.certs) && p.certs.length > 0;

    if (!hasInsurance || !hasCerts) {
      st.dao.statusByEngineerId[eid] = {
        status: "REJECTED",
        note: "Missing required uploads: insurance and at least one certification.",
        updatedAt: nowISO()
      };
      saveState(st);
      emitWs({
        topic: "dao",
        action: "updated",
        payload: { engineerId: eid, ...st.dao.statusByEngineerId[eid] }
      });
      track("dao_submit_rejected_demo", { engineerId: eid, hasInsurance, hasCerts });
      return st.dao.statusByEngineerId[eid];
    }

    st.dao.statusByEngineerId[eid] = {
      status: "PENDING",
      note: "In DAO review queue.",
      updatedAt: nowISO()
    };

    const existing = st.dao.queue.find((x) => x.engineerId === eid);
    if (!existing) {
      st.dao.queue.unshift({
        engineerId: eid,
        fullName: p.fullName,
        country: p.country,
        language: p.language,
        tradePrimary: p.tradePrimary,
        status: "PENDING",
        createdAt: nowISO()
      });
    }

    saveState(st);
    track("dao_submit_demo", { engineerId: eid });
    emitWs({ topic: "dao", action: "submitted", payload: { engineerId: eid } });

    return st.dao.statusByEngineerId[eid];
  }

  async function resubmitDAO() {
    const st = loadState();
    const eid = st.engineerProfile.engineerId || "eng_demo";
    st.dao.statusByEngineerId[eid] = { status: "PENDING", note: "Resubmitted to DAO.", updatedAt: nowISO() };

    const existing = st.dao.queue.find((x) => x.engineerId === eid);
    if (!existing) {
      st.dao.queue.unshift({
        engineerId: eid,
        ...st.engineerProfile,
        status: "PENDING",
        createdAt: nowISO()
      });
    }

    saveState(st);
    track("dao_resubmit_demo", { engineerId: eid });
    emitWs({ topic: "dao", action: "resubmitted", payload: { engineerId: eid } });
    return st.dao.statusByEngineerId[eid];
  }

  async function getDaoQueue() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/dao/queue", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return st.dao.queue.slice(0, 50);
  }

  async function approveDaoEngineer(engineerId, note = "Approved") {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/dao/approve", {
          method: "POST",
          body: JSON.stringify({ engineerId, note })
        });
        track("dao_approve_live", { engineerId });
        return r;
      } catch {}
    }

    const st = loadState();
    const eid = engineerId || st.role.engineerId || "eng_demo";

    st.dao.statusByEngineerId[eid] = { status: "APPROVED_CERTIFIED", note, updatedAt: nowISO() };
    st.dao.queue = st.dao.queue.filter((x) => x.engineerId !== eid);
    saveState(st);

    track("dao_approved_demo", { engineerId: eid });
    emitWs({ topic: "dao", action: "approved", payload: { engineerId: eid, status: "APPROVED_CERTIFIED" } });
    return st.dao.statusByEngineerId[eid];
  }

  async function rejectDaoEngineer(engineerId, note = "Rejected") {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/dao/reject", {
          method: "POST",
          body: JSON.stringify({ engineerId, note })
        });
        track("dao_reject_live", { engineerId });
        return r;
      } catch {}
    }

    const st = loadState();
    const eid = engineerId || st.role.engineerId || "eng_demo";

    st.dao.statusByEngineerId[eid] = { status: "REJECTED", note, updatedAt: nowISO() };
    st.dao.queue = st.dao.queue.filter((x) => x.engineerId !== eid);
    saveState(st);

    track("dao_rejected_demo", { engineerId: eid });
    emitWs({ topic: "dao", action: "rejected", payload: { engineerId: eid } });
    return st.dao.statusByEngineerId[eid];
  }

  // (continued in Part 3)
  // ---------------------------- Escrow (Real-time) ----------------------------
  function escrowStatusSnapshot(st) {
    const e = st.escrow;
    return {
      provider: e.provider,
      accountName: e.accountName,
      currency: e.currency,
      ibanMasked: e.ibanMasked,
      refPrefix: e.refPrefix,
      heldInEscrowGBP: clampMoney(e.heldInEscrowGBP),
      releasedGBP: clampMoney(e.releasedGBP),
      refundedGBP: clampMoney(e.refundedGBP),
      updatedAt: e.updatedAt
    };
  }

  async function getEscrowStatus() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/payments/escrow/status", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return { status: escrowStatusSnapshot(st), ledger: st.escrow.ledger.slice(0, 80) };
  }

  async function escrowDeposit({ amountGBP, reference, payerLabel, role, ticketId }) {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/payments/escrow/deposit", {
          method: "POST",
          body: JSON.stringify({ amountGBP, reference, payerLabel, role, ticketId })
        });
        track("escrow_deposit_live", { amountGBP });
        return r;
      } catch {}
    }

    const st = loadState();
    const amt = clampMoney(amountGBP || 0);

    const entry = {
      id: uuid(),
      type: "deposit",
      amountGBP: amt,
      reference: reference || "NF-ESCROW",
      payerLabel: payerLabel || "Client/FM Deposit",
      role: role || st.role.role,
      ticketId: ticketId || null,
      status: "ok",
      createdAt: nowISO()
    };

    st.escrow.heldInEscrowGBP = clampMoney((st.escrow.heldInEscrowGBP || 0) + amt);
    st.escrow.updatedAt = nowISO();
    st.escrow.ledger.unshift(entry);
    st.escrow.ledger = st.escrow.ledger.slice(0, 200);
    saveState(st);

    track("escrow_deposit_demo", { amountGBP: amt });
    emitWs({ type: "escrow:update", status: escrowStatusSnapshot(st), ledgerEntry: entry });
    return { status: escrowStatusSnapshot(st), ledgerEntry: entry };
  }

  async function escrowRelease({ amountGBP, role, ticketId }) {
    const st = loadState();
    const amt = clampMoney(Math.min(Number(amountGBP || 0), Number(st.escrow.heldInEscrowGBP || 0)));

    const entry = {
      id: uuid(),
      type: "release",
      amountGBP: amt,
      reference: st.escrow.refPrefix,
      payerLabel: "Notfall Escrow",
      role: role || st.role.role,
      ticketId: ticketId || null,
      status: "ok",
      createdAt: nowISO()
    };

    st.escrow.heldInEscrowGBP = clampMoney((st.escrow.heldInEscrowGBP || 0) - amt);
    st.escrow.releasedGBP = clampMoney((st.escrow.releasedGBP || 0) + amt);
    st.escrow.updatedAt = nowISO();
    st.escrow.ledger.unshift(entry);
    st.escrow.ledger = st.escrow.ledger.slice(0, 200);
    saveState(st);

    track("escrow_release_demo", { amountGBP: amt });
    emitWs({ type: "escrow:update", status: escrowStatusSnapshot(st), ledgerEntry: entry });
    return { status: escrowStatusSnapshot(st), ledgerEntry: entry };
  }

  async function escrowRefund({ amountGBP, role, ticketId }) {
    const st = loadState();
    const amt = clampMoney(Math.min(Number(amountGBP || 0), Number(st.escrow.heldInEscrowGBP || 0)));

    const entry = {
      id: uuid(),
      type: "refund",
      amountGBP: amt,
      reference: st.escrow.refPrefix,
      payerLabel: "Notfall Escrow",
      role: role || st.role.role,
      ticketId: ticketId || null,
      status: "ok",
      createdAt: nowISO()
    };

    st.escrow.heldInEscrowGBP = clampMoney((st.escrow.heldInEscrowGBP || 0) - amt);
    st.escrow.refundedGBP = clampMoney((st.escrow.refundedGBP || 0) + amt);
    st.escrow.updatedAt = nowISO();
    st.escrow.ledger.unshift(entry);
    st.escrow.ledger = st.escrow.ledger.slice(0, 200);
    saveState(st);

    track("escrow_refund_demo", { amountGBP: amt });
    emitWs({ type: "escrow:update", status: escrowStatusSnapshot(st), ledgerEntry: entry });
    return { status: escrowStatusSnapshot(st), ledgerEntry: entry };
  }

  async function listEscrowLedger() {
    const st = loadState();
    return st.escrow.ledger.slice(0, 80);
  }

  // ---------------------------- Tickets ↔ Tasks Sync ----------------------------
  function buildTicket(form) {
    const id = uuid();
    return {
      id,
      ticketId: id,
      site: form.site || "Level39 - 1 Canada Square",
      siteCode: form.siteCode || "L39",
      assetId: form.assetId || null,
      summary: form.summary || "Demo ticket",
      description: form.description || "",
      priority: form.priority || "HIGH",
      trade: form.trade || "HVAC",
      status: "OPEN",
      ramsRequired: !!form.ramsRequired || isCriticalPriority(form.priority),
      depositAmountGBP: clampMoney(form.depositAmountGBP || 0),
      source: form.source || "Manual",
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
  }

  function updateTicketStatus(ticketId, status, extra = {}) {
    const st = loadState();
    const idx = st.tickets.findIndex((t) => (t.ticketId || t.id) === ticketId);
    if (idx < 0) return null;

    st.tickets[idx] = { ...st.tickets[idx], status, ...extra, updatedAt: nowISO() };
    saveState(st);

    emitWs({ topic: "ticket", action: "updated", payload: st.tickets[idx] });
    return st.tickets[idx];
  }

  function buildOfferFromTicket(st, ticket) {
    const offerId = uuid();
    const urgent = isCriticalPriority(ticket.priority);
    const candidates = pickCandidatesForTicket(st, ticket);

    return {
      id: offerId,
      _id: offerId,
      ticketId: ticket.ticketId || ticket.id,
      summary: ticket.summary,
      site: ticket.site,
      siteCode: ticket.siteCode,
      assetId: ticket.assetId,
      trade: ticket.trade,
      priority: ticket.priority,
      urgent,
      status: "NEW",
      ramsRequired: !!ticket.ramsRequired,
      candidateEngineerIds: candidates, // IMPORTANT: used by engineer inbox filtering + live WS targeting
      sla: {
        responseMins: urgent ? 15 : 120,
        onSiteMins: urgent ? 60 : 240,
        breachRisk: urgent ? "Medium" : "Low"
      },
      location: {
        label: ticket.site,
        lat: 51.5055,
        lng: -0.0196
      },
      accessNotes: ticket.accessNotes || "Report to reception. Demo access code: 1234",
      payoutBufferGBP: Math.min(200, clampMoney(ticket.depositAmountGBP || 200)),
      createdAt: nowISO()
    };
  }

  async function createDemoTicket(form) {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch("/api/demo/tickets", { method: "POST", body: JSON.stringify(form) });
        track("ticket_created_live", { id: r?.id || r?.ticketId });
        return r;
      } catch {}
    }

    const st = loadState();
    ensureClient(st);
    ensureMarketplace(st);

    const ticket = buildTicket(form || {});
    st.tickets.unshift(ticket);
    st.tickets = st.tickets.slice(0, 150);
    saveState(st);

    track("ticket_created_demo", { ticketId: ticket.ticketId, trade: ticket.trade, priority: ticket.priority });

    // Mirror escrow deposit automatically
    const dep = clampMoney(ticket.depositAmountGBP || 0);
    if (dep > 0) {
      await escrowDeposit({
        amountGBP: dep,
        reference: `NF-${ticket.siteCode || "L39"}-${String(ticket.ticketId).slice(0, 6).toUpperCase()}`,
        payerLabel: "Client/FM Deposit",
        role: "CLIENT",
        ticketId: ticket.ticketId
      });
    }

    emitWs({ topic: "ticket", action: "created", payload: ticket });

    // Offer a task after a beat
    await sleep(450);
    const st2 = loadState(); // reload to avoid stomping
    ensureClient(st2);
    ensureMarketplace(st2);

    const offer = buildOfferFromTicket(st2, ticket);
    st2.tasks.unshift(offer);
    st2.tasks = st2.tasks.slice(0, 150);
    saveState(st2);

    emitWs({ topic: "task", action: "offer", payload: offer });
    track("task_offer_emitted_demo", { offerId: offer.id, ticketId: ticket.ticketId, candidates: offer.candidateEngineerIds.length });

    return ticket;
  }

  async function getClientTickets() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/demo/tickets", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return st.tickets.slice(0, 80);
  }

  // ---------------------------- Tasks (Inbox + Evidence + History) ----------------------------
  async function getTasks() {
    if (cfg.liveMode) {
      try { return await liveFetch("/api/demo/tasks", { method: "GET" }); } catch {}
    }
    const st = loadState();
    return st.tasks.slice(0, 80);
  }

  function updateTaskStatus(id, status, extra = {}) {
    const st = loadState();
    const idx = st.tasks.findIndex((t) => (t._id || t.id) === id);
    if (idx < 0) return null;

    st.tasks[idx] = { ...st.tasks[idx], status, ...extra, updatedAt: nowISO() };
    saveState(st);

    emitWs({ topic: "task", action: "update", payload: st.tasks[idx] });
    return st.tasks[idx];
  }

  async function acceptTask(id) {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch(`/api/demo/tasks/${encodeURIComponent(id)}/accept`, { method: "POST" });
        track("task_accepted_live", { id });
        return r;
      } catch {}
    }

    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    track("task_accepted_demo", { id });
    updateTicketStatus(t.ticketId, "IN_PROGRESS", { acceptedAt: nowISO() });

    return updateTaskStatus(id, "ACCEPTED", { acceptedAt: nowISO(), acceptedBy: st.role.engineerId || "eng_demo" });
  }

  async function declineTask(id) {
    if (cfg.liveMode) {
      try {
        const r = await liveFetch(`/api/demo/tasks/${encodeURIComponent(id)}/decline`, { method: "POST" });
        track("task_declined_live", { id });
        return r;
      } catch {}
    }

    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    track("task_declined_demo", { id });
    updateTicketStatus(t.ticketId, "OPEN", { note: "Offer declined. Re-matching..." });

    return updateTaskStatus(id, "DECLINED", { declinedAt: nowISO(), declinedBy: st.role.engineerId || "eng_demo" });
  }

  async function startTravel(id) {
    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    track("task_travel_demo", { id });
    updateTicketStatus(t.ticketId, "EN_ROUTE", { travelStartedAt: nowISO() });

    return updateTaskStatus(id, "ENROUTE", { travelStartedAt: nowISO() });
  }

  async function arriveOnSite(id) {
    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    track("task_arrived_demo", { id });
    updateTicketStatus(t.ticketId, "ON_SITE", { arrivedAt: nowISO() });

    return updateTaskStatus(id, "ONSITE", { arrivedAt: nowISO() });
  }

  async function requestComplete(id, meta = {}) {
    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    track("task_request_complete_demo", { id });
    return updateTaskStatus(id, "AWAITING_EVIDENCE", {
      completionRequestedAt: nowISO(),
      ramsRequired: !!t.ramsRequired,
      ...meta
    });
  }

  async function submitEvidence(id, evidence = {}) {
    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return null;

    const ev = {
      beforePhotos: evidence.beforePhotos || [],
      afterPhotos: evidence.afterPhotos || [],
      notes: evidence.notes || "",
      materials: Array.isArray(evidence.materials) ? evidence.materials : [],
      labourMins: Number(evidence.labourMins || 0),
      uploadedAt: nowISO()
    };

    track("task_evidence_submitted_demo", { id, before: ev.beforePhotos.length, after: ev.afterPhotos.length });
    return updateTaskStatus(id, "EVIDENCE_SUBMITTED", { evidence: ev });
  }

  async function completeTask(id, costBreakdown = {}) {
    const st = loadState();
    const t = st.tasks.find((x) => (x._id || x.id) === id);
    if (!t) return { error: "Task not found." };

    const ev = t.evidence || {};
    const hasBefore = Array.isArray(ev.beforePhotos) && ev.beforePhotos.length > 0;
    const hasAfter = Array.isArray(ev.afterPhotos) && ev.afterPhotos.length > 0;
    const hasNotes = String(ev.notes || "").trim().length > 5;

    if (!hasBefore || !hasAfter || !hasNotes) {
      track("task_complete_blocked_missing_evidence", { id, hasBefore, hasAfter, hasNotes });
      return {
        error: "Cannot complete task. Missing required evidence (before + after photos + notes).",
        required: { beforePhotos: true, afterPhotos: true, notes: true }
      };
    }

    track("task_completed_demo", { id });

    const labourGBP = clampMoney(costBreakdown.labourGBP ?? (clampMoney((t.payoutBufferGBP || 0) * 0.7)));
    const materialsGBP = clampMoney(costBreakdown.materialsGBP ?? 0);
    const serviceFeeGBP = clampMoney(costBreakdown.serviceFeeGBP ?? ((labourGBP + materialsGBP) * 0.05));
    const totalGBP = clampMoney(labourGBP + materialsGBP + serviceFeeGBP);

    const startedAt = t.acceptedAt || t.createdAt;
    const completedAt = nowISO();
    const durationMins = Math.max(
      1,
      Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
    );

    const updated = updateTaskStatus(id, "COMPLETED", {
      completedAt,
      cost: { labourGBP, materialsGBP, serviceFeeGBP, totalGBP },
      durationMins
    });

    updateTicketStatus(t.ticketId, "COMPLETED", { completedAt });

    const buffer = clampMoney(t?.payoutBufferGBP || 0);
    if (buffer > 0) {
      await escrowRelease({
        amountGBP: Math.min(200, buffer),
        role: "ESCROW",
        ticketId: t.ticketId
      });
    }

    const st2 = loadState();
    st2.taskHistory.unshift({
      historyId: uuid(),
      ticketId: t.ticketId,
      taskId: id,
      summary: t.summary,
      trade: t.trade,
      priority: t.priority,
      site: t.site,
      assetId: t.assetId || null,
      durationMins,
      cost: updated?.cost || null,
      completedAt
    });
    st2.taskHistory = st2.taskHistory.slice(0, 300);
    saveState(st2);

    emitWs({ topic: "task", action: "history", payload: st2.taskHistory[0] });
    return updated;
  }

  async function getTaskHistory() {
    const st = loadState();
    return st.taskHistory.slice(0, 120);
  }

  async function getTaskHistorySummary() {
    const st = loadState();
    const rows = st.taskHistory || [];

    const byTrade = {};
    for (const r of rows) {
      const k = r.trade || "Unknown";
      byTrade[k] = byTrade[k] || { trade: k, count: 0, totalMins: 0, avgMins: 0 };
      byTrade[k].count += 1;
      byTrade[k].totalMins += Number(r.durationMins || 0);
      byTrade[k].avgMins = Math.round(byTrade[k].totalMins / byTrade[k].count);
    }

    const tradeSummary = Object.values(byTrade).sort((a, b) => (b.count - a.count));

    return {
      totalCompleted: rows.length,
      avgMinsOverall:
        rows.length > 0 ? Math.round(rows.reduce((s, x) => s + Number(x.durationMins || 0), 0) / rows.length) : 0,
      tradeSummary
    };
  }

  // ---------------------------- Reminders (Non-urgent workflow hook) ----------------------------
  async function addReminderForTask(taskId, whenISO, note = "Follow up") {
    const st = loadState();
    st.reminders.unshift({
      id: uuid(),
      taskId,
      whenISO: whenISO || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      note,
      createdAt: nowISO()
    });
    st.reminders = st.reminders.slice(0, 100);
    saveState(st);

    emitWs({ topic: "reminder", action: "created", payload: st.reminders[0] });
    track("reminder_created_demo", { taskId });
    return st.reminders[0];
  }

  async function listReminders() {
    const st = loadState();
    return st.reminders.slice(0, 50);
  }

  // (continued in Part 4)
  // ---------------------------- Assets + PLC Alerts (Editable) ----------------------------
  async function getAssets() {
    const st = loadState();
    return st.assets.slice(0, 80);
  }

  async function createAsset(asset) {
    const st = loadState();
    const a = {
      id: uuid(),
      _id: uuid(),
      name: asset?.name || "Demo Asset",
      siteCode: asset?.siteCode || "L39",
      siteName: asset?.siteName || "Level39 — 1 Canada Square",
      category: asset?.category || "Plant",
      model: asset?.model || "",
      serial: asset?.serial || "",
      notes: asset?.notes || "",
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    st.assets.unshift(a);
    st.assets = st.assets.slice(0, 200);
    saveState(st);

    track("asset_created_demo", { name: a.name, siteCode: a.siteCode });
    emitWs({ topic: "assetRegistry", action: "updated", payload: a });
    return a;
  }

  async function updateAsset(assetId, patch = {}) {
    const st = loadState();
    const idx = st.assets.findIndex((x) => (x.id || x._id) === assetId);
    if (idx < 0) return null;

    st.assets[idx] = { ...st.assets[idx], ...patch, updatedAt: nowISO() };
    saveState(st);

    emitWs({ topic: "assetRegistry", action: "updated", payload: st.assets[idx] });
    track("asset_updated_demo", { assetId });
    return st.assets[idx];
  }

  async function deleteAsset(assetId) {
    const st = loadState();
    const before = st.assets.length;
    st.assets = st.assets.filter((x) => (x.id || x._id) !== assetId);
    saveState(st);

    if (st.assets.length !== before) {
      emitWs({ topic: "assetRegistry", action: "deleted", payload: { assetId } });
      track("asset_deleted_demo", { assetId });
      return true;
    }
    return false;
  }

  async function getPlcAlerts() {
    const st = loadState();
    return st.plcAlerts.slice(0, 80);
  }

  async function createTestPlcAlert(payload) {
    const st = loadState();
    const a = {
      id: uuid(),
      _id: uuid(),
      severity: payload?.severity || "High",
      message: payload?.message || "Demo PLC alert",
      code: payload?.code || "E-DEMO-001",
      siteName: payload?.siteName || "Level39 — 1 Canada Square",
      siteCode: payload?.siteCode || "L39",
      assetId: payload?.assetId || null,
      plcTag: payload?.plcTag || "DB1.FaultCode",
      createdAt: nowISO()
    };

    st.plcAlerts.unshift(a);
    st.plcAlerts = st.plcAlerts.slice(0, 200);
    saveState(st);

    track("plc_alert_created_demo", { severity: a.severity, code: a.code });
    emitWs({ topic: "plcAlert", action: "created", payload: a });

    // Critical -> auto-create a ticket (mirrors HardStop/Critical flow)
    if (String(a.severity).toLowerCase() === "critical") {
      await createDemoTicket({
        site: a.siteName,
        siteCode: a.siteCode,
        assetId: a.assetId || null,
        summary: `PLC Critical Alert ${a.code}`,
        description: `${a.message} • Tag: ${a.plcTag}`,
        priority: "CRITICAL",
        trade: "Industrial / PLC",
        depositAmountGBP: 200,
        ramsRequired: true,
        source: "PLC"
      });
    }

    return a;
  }

  // ---------------------------- Partner Access Persistence ----------------------------
  function loadPartnerAccess() {
    const p = safeParse(localStorage.getItem(cfg.partnerKey), null);
    if (p) return p;

    const initial = {
      partners: [
        { partnerId: "p_level39_fm", name: "Level39 FM", type: "FM", status: "APPROVED", createdAt: nowISO() },
        { partnerId: "p_oem_plc_demo", name: "OEM Industrial Demo", type: "INDUSTRIAL", status: "PENDING", createdAt: nowISO() }
      ],
      apiKeys: [],
      audit: [],
      rate: { perMinute: 100, perDay: 10000 }
    };

    localStorage.setItem(cfg.partnerKey, JSON.stringify(initial));
    return initial;
  }

  function savePartnerAccess(p) {
    localStorage.setItem(cfg.partnerKey, JSON.stringify(p));
  }

  function maskSecret(s) {
    const x = String(s || "");
    if (x.length <= 8) return "••••••••";
    return `${x.slice(0, 4)}••••••••${x.slice(-4)}`;
  }

  function randKey(prefix = "nfk") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  }

  function auditPush(entry) {
    const pa = loadPartnerAccess();
    pa.audit.unshift({ id: uuid(), at: nowISO(), ...entry });
    pa.audit = pa.audit.slice(0, 500);
    savePartnerAccess(pa);
    emitWs({ topic: "partnerApi", action: "audit", payload: pa.audit[0] });
    return pa.audit[0];
  }

  function getPartnerAccess() {
    return loadPartnerAccess();
  }

  function listApiKeys(partnerId = null) {
    const pa = loadPartnerAccess();
    const keys = pa.apiKeys || [];
    return partnerId ? keys.filter((k) => k.partnerId === partnerId) : keys;
  }

  function createApiKey(partnerId, scopes = [], env = "SANDBOX") {
    const pa = loadPartnerAccess();
    const pid = partnerId || "p_level39_fm";

    const keyId = uuid();
    const apiKey = randKey("nfk");
    const secret = randKey("nfs");

    const record = {
      keyId,
      partnerId: pid,
      env: String(env || "SANDBOX").toUpperCase(),
      apiKey,
      secret, // demo stores full; UI should show once then mask
      secretMasked: maskSecret(secret),
      scopes: Array.isArray(scopes) ? scopes : [],
      status: "ACTIVE",
      createdAt: nowISO(),
      lastUsedAt: null,
      usage: { day: {}, minute: {} },
      ipAllowlist: []
    };

    pa.apiKeys.unshift(record);
    pa.apiKeys = pa.apiKeys.slice(0, 100);
    savePartnerAccess(pa);

    auditPush({ partnerId: pid, keyId, action: "key_created", env: record.env, scopes: record.scopes });
    emitWs({ topic: "partnerApi", action: "keyCreated", payload: { ...record, secret } });

    track("partner_key_created_demo", { partnerId: pid, env: record.env });
    return record;
  }

  function rotateSecret(keyId) {
    const pa = loadPartnerAccess();
    const idx = pa.apiKeys.findIndex((k) => k.keyId === keyId);
    if (idx < 0) return null;

    const newSecret = randKey("nfs");
    pa.apiKeys[idx] = { ...pa.apiKeys[idx], secret: newSecret, secretMasked: maskSecret(newSecret), rotatedAt: nowISO() };
    savePartnerAccess(pa);

    auditPush({ partnerId: pa.apiKeys[idx].partnerId, keyId, action: "secret_rotated" });
    emitWs({ topic: "partnerApi", action: "keyRotated", payload: { keyId, secret: newSecret } });
    track("partner_key_rotated_demo", { keyId });
    return pa.apiKeys[idx];
  }

  function revokeKey(keyId) {
    const pa = loadPartnerAccess();
    const idx = pa.apiKeys.findIndex((k) => k.keyId === keyId);
    if (idx < 0) return null;

    pa.apiKeys[idx] = { ...pa.apiKeys[idx], status: "REVOKED", revokedAt: nowISO() };
    savePartnerAccess(pa);

    auditPush({ partnerId: pa.apiKeys[idx].partnerId, keyId, action: "key_revoked" });
    emitWs({ topic: "partnerApi", action: "keyRevoked", payload: { keyId } });
    track("partner_key_revoked_demo", { keyId });
    return pa.apiKeys[idx];
  }

  function rateLimitCheck(keyRecord) {
    const pa = loadPartnerAccess();
    const perMinute = pa.rate?.perMinute || 100;
    const perDay = pa.rate?.perDay || 10000;

    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    const minKey = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM

    keyRecord.usage = keyRecord.usage || { day: {}, minute: {} };
    keyRecord.usage.day[dayKey] = keyRecord.usage.day[dayKey] || 0;
    keyRecord.usage.minute[minKey] = keyRecord.usage.minute[minKey] || 0;

    if (keyRecord.usage.day[dayKey] >= perDay) return { ok: false, reason: "rate_limited_day" };
    if (keyRecord.usage.minute[minKey] >= perMinute) return { ok: false, reason: "rate_limited_minute" };

    keyRecord.usage.day[dayKey] += 1;
    keyRecord.usage.minute[minKey] += 1;
    return { ok: true };
  }

  function verifyRequest({ authorization, apiKey, endpoint, method, scopesRequired = [] } = {}) {
    const pa = loadPartnerAccess();
    const token = apiKey || (String(authorization || "").startsWith("Bearer ") ? String(authorization).slice(7) : "");
    const rec = (pa.apiKeys || []).find((k) => k.apiKey === token);

    if (!rec) {
      auditPush({ partnerId: "unknown", keyId: null, action: "auth_failed", endpoint, method, reason: "unknown_key" });
      return { ok: false, status: 401, reason: "invalid_key" };
    }

    if (rec.status !== "ACTIVE") {
      auditPush({ partnerId: rec.partnerId, keyId: rec.keyId, action: "auth_failed", endpoint, method, reason: "revoked" });
      return { ok: false, status: 403, reason: "revoked" };
    }

    const required = Array.isArray(scopesRequired) ? scopesRequired : [];
    const allowed = Array.isArray(rec.scopes) ? rec.scopes : [];
    const missing = required.filter((s) => !allowed.includes(s));
    if (missing.length) {
      auditPush({ partnerId: rec.partnerId, keyId: rec.keyId, action: "auth_failed", endpoint, method, reason: "missing_scope", missing });
      return { ok: false, status: 403, reason: "missing_scope", missing };
    }

    const rl = rateLimitCheck(rec);
    if (!rl.ok) {
      auditPush({ partnerId: rec.partnerId, keyId: rec.keyId, action: "rate_limited", endpoint, method, reason: rl.reason });
      return { ok: false, status: 429, reason: rl.reason };
    }

    rec.lastUsedAt = nowISO();
    savePartnerAccess(pa);

    auditPush({ partnerId: rec.partnerId, keyId: rec.keyId, action: "auth_ok", endpoint, method });
    return { ok: true, status: 200, partnerId: rec.partnerId, keyId: rec.keyId, env: rec.env };
  }

  function simulateApiCall({ apiKey, endpoint, method = "POST", scopesRequired = [], payload = {} } = {}) {
    const v = verifyRequest({ apiKey, endpoint, method, scopesRequired });
    if (!v.ok) return v;

    if (endpoint === "/plc/alerts" && method === "POST") createTestPlcAlert(payload);
    if (endpoint === "/tickets" && method === "POST") createDemoTicket(payload);

    emitWs({
      topic: "partnerApi",
      action: "call",
      payload: { partnerId: v.partnerId, endpoint, method, ok: true, at: nowISO() }
    });

    track("partner_api_call_demo", { endpoint, method, partnerId: v.partnerId });
    return { ok: true, partnerId: v.partnerId };
  }

  async function getAuditLog() {
    const pa = loadPartnerAccess();
    return (pa.audit || []).slice(0, 120);
  }

  // (continued in Part 5)
  // ---------------------------- Client Pools (Public API) ----------------------------
  function listMarketplaceEngineers() {
    const st = loadState();
    ensureMarketplace(st);
    return (st.marketplaceEngineers || []).slice(0, 200);
  }

  function getClientSourcing() {
    const st = loadState();
    ensureClient(st);
    ensureMarketplace(st);
    return {
      client: st.client,
      marketplaceEngineers: st.marketplaceEngineers
    };
  }

  function updateMatchingPolicy(patch = {}) {
    const st = loadState();
    ensureClient(st);

    st.client.matchingPolicy = { ...(st.client.matchingPolicy || {}), ...(patch || {}) };
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_matching_policy_updated", { patch });
    emitWs({ topic: "client", action: "policyUpdated", payload: { matchingPolicy: st.client.matchingPolicy } });

    return st.client.matchingPolicy;
  }

  function favouriteEngineer(engineerId) {
    const st = loadState();
    ensureClient(st);

    const eid = String(engineerId || "").trim();
    if (!eid) return { error: "Missing engineerId." };

    st.client.favouriteEngineerIds = uniqueKeepOrder([eid, ...(st.client.favouriteEngineerIds || [])]);
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_favourite_added", { engineerId: eid });
    emitWs({ topic: "client", action: "favouriteAdded", payload: { engineerId: eid } });

    return st.client.favouriteEngineerIds;
  }

  function unfavouriteEngineer(engineerId) {
    const st = loadState();
    ensureClient(st);

    const eid = String(engineerId || "").trim();
    st.client.favouriteEngineerIds = (st.client.favouriteEngineerIds || []).filter((x) => x !== eid);
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_favourite_removed", { engineerId: eid });
    emitWs({ topic: "client", action: "favouriteRemoved", payload: { engineerId: eid } });

    return st.client.favouriteEngineerIds;
  }

  function createEngineerPool(name = "My Pool") {
    const st = loadState();
    ensureClient(st);

    const pool = {
      poolId: uuid(),
      name: String(name || "My Pool"),
      engineerIds: [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    st.client.pools.unshift(pool);
    st.client.pools = st.client.pools.slice(0, 50);
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_pool_created", { poolId: pool.poolId });
    emitWs({ topic: "client", action: "poolCreated", payload: pool });

    return pool;
  }

  function renameEngineerPool(poolId, name) {
    const st = loadState();
    ensureClient(st);

    const idx = (st.client.pools || []).findIndex((p) => p.poolId === poolId);
    if (idx < 0) return null;

    st.client.pools[idx] = { ...st.client.pools[idx], name: String(name || st.client.pools[idx].name), updatedAt: nowISO() };
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_pool_renamed", { poolId });
    emitWs({ topic: "client", action: "poolUpdated", payload: st.client.pools[idx] });

    return st.client.pools[idx];
  }

  function deleteEngineerPool(poolId) {
    const st = loadState();
    ensureClient(st);

    const before = (st.client.pools || []).length;
    st.client.pools = (st.client.pools || []).filter((p) => p.poolId !== poolId);
    st.client.updatedAt = nowISO();
    saveState(st);

    if ((st.client.pools || []).length !== before) {
      track("client_pool_deleted", { poolId });
      emitWs({ topic: "client", action: "poolDeleted", payload: { poolId } });
      return true;
    }
    return false;
  }

  function addEngineerToPool(poolId, engineerId) {
    const st = loadState();
    ensureClient(st);

    const idx = (st.client.pools || []).findIndex((p) => p.poolId === poolId);
    if (idx < 0) return null;

    const eid = String(engineerId || "").trim();
    st.client.pools[idx].engineerIds = uniqueKeepOrder([...(st.client.pools[idx].engineerIds || []), eid]);
    st.client.pools[idx].updatedAt = nowISO();
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_pool_engineer_added", { poolId, engineerId: eid });
    emitWs({ topic: "client", action: "poolUpdated", payload: st.client.pools[idx] });

    return st.client.pools[idx];
  }

  function removeEngineerFromPool(poolId, engineerId) {
    const st = loadState();
    ensureClient(st);

    const idx = (st.client.pools || []).findIndex((p) => p.poolId === poolId);
    if (idx < 0) return null;

    const eid = String(engineerId || "").trim();
    st.client.pools[idx].engineerIds = (st.client.pools[idx].engineerIds || []).filter((x) => x !== eid);
    st.client.pools[idx].updatedAt = nowISO();
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_pool_engineer_removed", { poolId, engineerId: eid });
    emitWs({ topic: "client", action: "poolUpdated", payload: st.client.pools[idx] });

    return st.client.pools[idx];
  }

  function addInhouseEngineer(engineer) {
    const st = loadState();
    ensureClient(st);

    const e = engineer || {};
    const record = {
      engineerId: e.engineerId || uuid(),
      fullName: e.fullName || "In-house Engineer",
      tradePrimary: e.tradePrimary || "General",
      phone: e.phone || "",
      email: e.email || "",
      isDaoCertified: !!e.isDaoCertified,
      createdAt: nowISO(),
      updatedAt: nowISO()
    };

    st.client.inhouseTeam.unshift(record);
    st.client.inhouseTeam = st.client.inhouseTeam.slice(0, 200);
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_inhouse_added", { engineerId: record.engineerId });
    emitWs({ topic: "client", action: "inhouseAdded", payload: record });

    return record;
  }

  function updateInhouseEngineer(engineerId, patch = {}) {
    const st = loadState();
    ensureClient(st);

    const idx = (st.client.inhouseTeam || []).findIndex((x) => x.engineerId === engineerId);
    if (idx < 0) return null;

    st.client.inhouseTeam[idx] = { ...st.client.inhouseTeam[idx], ...(patch || {}), updatedAt: nowISO() };
    st.client.updatedAt = nowISO();
    saveState(st);

    track("client_inhouse_updated", { engineerId });
    emitWs({ topic: "client", action: "inhouseUpdated", payload: st.client.inhouseTeam[idx] });

    return st.client.inhouseTeam[idx];
  }

  function removeInhouseEngineer(engineerId) {
    const st = loadState();
    ensureClient(st);

    const before = (st.client.inhouseTeam || []).length;
    st.client.inhouseTeam = (st.client.inhouseTeam || []).filter((x) => x.engineerId !== engineerId);
    st.client.updatedAt = nowISO();
    saveState(st);

    if ((st.client.inhouseTeam || []).length !== before) {
      track("client_inhouse_removed", { engineerId });
      emitWs({ topic: "client", action: "inhouseRemoved", payload: { engineerId } });
      return true;
    }
    return false;
  }

  // ---------------------------- Public API ----------------------------
  const FakeAPI = {
    configure(next = {}) {
      Object.assign(cfg, next || {});
      track("fakeapi_configure", { liveMode: !!cfg.liveMode, apiBase: cfg.apiBase, wsUrl: cfg.wsUrl });
      return { ...cfg };
    },

    getWidgetSocket() {
      return getSharedSocket();
    },

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

    // profile helper buttons
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

    // client pools (FM sourcing)
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
    simulateApiCall
  };

  window.FakeAPI = FakeAPI;

  // init state
  loadState();
  loadPartnerAccess();

  // demo heartbeat (keeps widgets feeling "live")
  setInterval(() => {
    const ws = getSharedSocket();
    if (ws instanceof DemoSocket) {
      ws._emit("message", JSON.stringify({ topic: "system", action: "ping", at: nowISO() }));
    }
  }, 6000);
})();

// api/src/routes/clientProfileRoutes.js
import express from "express";

import Client from "../models/clientModel.js";
import * as DSSAdapter from "../services/DSSAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Attach runId to every request for tracing
router.use((req, res, next) => DSSAdapter.applyRequestGuards(req, res, next));

/**
 * GET /api/client-profile
 * Get current user's client/FM profile
 */
router.get("/", protect, async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user._id;

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId.toString(),
      scope: "clientProfile:view",
      meta: { ip: req.ip },
    });

    const profile = await Client.findOne({ user: userId }).lean();

    await DSSAdapter.recordEvent(db, runId, "clientProfile", "view", {
      severity: "info",
      actor: userId.toString(),
      meta: { hasProfile: !!profile },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    if (!profile) {
      return res.status(404).json({ message: "Client profile not found" });
    }

    res.json(profile);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/client-profile
 * Create or update Client/FM profile (company, role, billing contact, KYC stub)
 *
 * Body:
 * {
 *   companyName,
 *   role,
 *   billingContact: { name, email, phone },
 *   isEnterprise,
 *   tags: [ "FM", "Industrial", ... ],
 *   kyc: {
 *     status,
 *     provider,
 *     reference,
 *     lastCheckedAt
 *   }
 * }
 */
router.post("/", protect, async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user._id;

  const {
    companyName,
    role,
    billingContact,
    isEnterprise,
    tags,
    kyc,
  } = req.body;

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId.toString(),
      scope: "clientProfile:upsert",
      meta: { companyName },
    });

    let profile = await Client.findOne({ user: userId });

    if (!profile) {
      profile = new Client({
        user: userId,
        companyName,
        role,
        billingContact,
        isEnterprise: !!isEnterprise,
        kyc: {
          status: kyc?.status || "pending",
          provider: kyc?.provider || null,
          reference: kyc?.reference || null,
          lastCheckedAt: kyc?.lastCheckedAt || null,
        },
        tags,
      });
    } else {
      profile.companyName = companyName ?? profile.companyName;
      profile.role = role ?? profile.role;
      profile.billingContact = billingContact ?? profile.billingContact;
      profile.isEnterprise =
        typeof isEnterprise === "boolean"
          ? isEnterprise
          : profile.isEnterprise;

      if (kyc) {
        profile.kyc = {
          ...(profile.kyc?.toObject ? profile.kyc.toObject() : profile.kyc),
          ...kyc,
        };
      }
      if (tags) profile.tags = tags;
    }

    await profile.save();

    await DSSAdapter.recordEvent(db, runId, "clientProfile", "upsert", {
      severity: "info",
      actor: userId.toString(),
      message: "Client profile created/updated",
      meta: {
        clientId: profile._id.toString(),
        companyName: profile.companyName,
        kycStatus: profile.kyc.status,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // Notify all widgets that client profile changed (incl. asset registry)
    widgetBus.broadcastWidgetEvent({
      topic: "clientProfile",
      action: "updated",
      clientId: profile._id.toString(),
      userId: userId.toString(),
      snapshot: {
        companyName: profile.companyName,
        role: profile.role,
        kycStatus: profile.kyc.status,
      },
    });

    res.status(200).json(profile);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/client-profile/properties
 * Add a new property/site to the current client
 */
router.post("/properties", protect, async (req, res, next) => {
  const db = req.app.get("models");
  const userId = req.user._id;
  const {
    name,
    code,
    addressLine1,
    addressLine2,
    city,
    postcode,
    country,
  } = req.body;

  try {
    const runId = await DSSAdapter.startRun(db, {
      initiatedBy: userId.toString(),
      scope: "clientProfile:addProperty",
      meta: { name, city },
    });

    const profile = await Client.findOne({ user: userId });
    if (!profile) {
      return res.status(404).json({ message: "Client profile not found" });
    }

    const property = {
      name,
      code,
      addressLine1,
      addressLine2,
      city,
      postcode,
      country,
    };

    profile.properties.push(property);
    await profile.save();

    const createdProperty =
      profile.properties[profile.properties.length - 1];

    await DSSAdapter.recordEvent(db, runId, "clientProfile", "property:add", {
      severity: "info",
      actor: userId.toString(),
      message: "Property added",
      meta: {
        clientId: profile._id.toString(),
        propertyId: createdProperty._id.toString(),
        name: createdProperty.name,
        city: createdProperty.city,
      },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    await DSSAdapter.finishRun(db, runId, { status: "completed" });

    // Notify widgets – asset registry widget will listen for this
    widgetBus.broadcastWidgetEvent({
      topic: "propertyRegistry",
      action: "propertyAdded",
      clientId: profile._id.toString(),
      property: {
        id: createdProperty._id.toString(),
        name: createdProperty.name,
        city: createdProperty.city,
        code: createdProperty.code,
      },
    });

    res.status(201).json(createdProperty);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/client-profile/properties
 * List properties for current client
 */
router.get("/properties", protect, async (req, res, next) => {
  const userId = req.user._id;

  try {
    const profile = await Client.findOne({ user: userId }).lean();
    if (!profile) {
      return res.status(404).json({ message: "Client profile not found" });
    }
    res.json(profile.properties || []);
  } catch (err) {
    next(err);
  }
});

export default router;

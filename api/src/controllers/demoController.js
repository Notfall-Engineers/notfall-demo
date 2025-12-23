// controllers/demoController.js
import crypto from "crypto";
import DemoRequest from "../models/demoRequestModel.js";

function generateToken() {
  return crypto.randomBytes(16).toString("hex"); // 32-char token
}

// POST /api/demo-request
export async function createDemoRequest(req, res) {
  try {
    const {
      name,
      email,
      company,
      role,
      size,
      time,
      notes,
      persona,
      region,
      interests,
      tenOutOfTen,
      referrer
    } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }

    const demoToken = generateToken();

    const doc = await DemoRequest.create({
      name,
      email,
      company,
      role,
      size,
      time,
      notes,
      persona,
      region,
      interests: Array.isArray(interests)
        ? interests
        : typeof interests === "string" && interests.length
        ? interests.split(",").map((s) => s.trim())
        : [],
      tenOutOfTen,
      referrer,
      demoToken
    });

    // We can also kick off email sending here with the /demo?token= link
    // sendDemoEmail(doc);

    return res.status(201).json({
      ok: true,
      demoToken,
      name: doc.name
    });
  } catch (err) {
    console.error("createDemoRequest error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// GET /api/demo-session/:token
export async function getDemoSession(req, res) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: "token required" });

    const doc = await DemoRequest.findOne({ demoToken: token }).lean();
    if (!doc) return res.status(404).json({ error: "session not found" });

    // keep only what the frontend needs
    return res.json({
      name: doc.name,
      email: doc.email,
      company: doc.company,
      role: doc.role,
      size: doc.size,
      time: doc.time,
      persona: doc.persona,
      region: doc.region,
      interests: doc.interests,
      tenOutOfTen: doc.tenOutOfTen,
      createdAt: doc.createdAt
    });
  } catch (err) {
    console.error("getDemoSession error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

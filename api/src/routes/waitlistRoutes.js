import { Router } from "express";
import { submitWaitlist } from "../controllers/waitlistController.js";
import validateWaitlist from "../middleware/validateWaitlist.js";

const router = Router();

/* --- Normalise interests BEFORE validation --- */
router.post("/", (req, res, next) => {
  const raw = req.body.interests;

  if (typeof raw === "string") {
    // "faster,compliance,sla" → ["faster","compliance","sla"]
    req.body.interests = raw
      .split(",")
      .map(v => v.trim())
      .filter(Boolean);
  } else if (!Array.isArray(raw)) {
    req.body.interests = [];
  }

  next();
}, validateWaitlist, submitWaitlist);

export default router;

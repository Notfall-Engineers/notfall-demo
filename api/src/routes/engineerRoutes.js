// src/routes/engineerRoutes.js
import express from "express";
import { requireRole } from "../middleware/requireRole.js";
import {
  getEngineerProfile,
  saveEngineerProfile,
  submitProfileToDAO,
  getDAOStatus,
  resubmitDAO,
  getTasksForEngineer,
  setTaskStatus,
  saveTaskRams,
  saveTaskEvidence,
  completeTask,
  getJobWallets,
} from "../controllers/engineerDashboardController.js";

const router = express.Router();

router.use(requireRole("ENGINEER"));

router.get("/profile", getEngineerProfile);
router.put("/profile", saveEngineerProfile);
router.post("/profile/submit-dao", submitProfileToDAO);
router.get("/dao-status", getDAOStatus);
router.post("/dao-resubmit", resubmitDAO);

router.get("/tasks", getTasksForEngineer);
router.post("/tasks/:id/accept", setTaskStatus("ASSIGNED", { acceptedAt: new Date() }));
router.post("/tasks/:id/decline", setTaskStatus("DECLINED"));
router.post(
  "/tasks/:id/start-travel",
  setTaskStatus("EN_ROUTE", { enRouteAt: new Date() })
);
router.post(
  "/tasks/:id/arrive-on-site",
  setTaskStatus("ON_SITE", { onSiteAt: new Date() })
);

router.post("/tasks/:id/rams", saveTaskRams);
router.post("/tasks/:id/evidence", saveTaskEvidence);
router.post("/tasks/:id/complete", completeTask);

router.get("/job-wallets", getJobWallets);

export default router;

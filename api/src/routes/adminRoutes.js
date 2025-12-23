// src/routes/adminRoutes.js
import express from "express";
import { requireRole } from "../middleware/requireRole.js";
import {
  listCertificationQueue,
  reviewEngineer,
  listPayments,
  refundPayment,
} from "../controllers/daoAdminController.js";

const router = express.Router();

router.use(requireRole("DAO_ADMIN"));

router.get("/dao/certifications", listCertificationQueue);
router.post("/dao/certifications/:engineerUserId/review", reviewEngineer);

router.get("/payments", listPayments);
router.post("/payments/:workflowId/refund", refundPayment);

export default router;

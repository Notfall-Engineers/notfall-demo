// src/controllers/daoAdminController.js
import EngineerProfile from "../models/EngineerProfile.js";
import Payment from "../models/paymentModel.js";
import DaoRevolutAdapter from "../services/DaoRevolutAdapter.js";

export const listCertificationQueue = async (_req, res, next) => {
  try {
    const pending = await EngineerProfile.find({
      daoStatus: { $in: ["PENDING", "REJECTED", "APPROVED"] },
    })
      .sort({ daoSubmittedAt: -1 })
      .lean();
    res.json(pending);
  } catch (err) {
    next(err);
  }
};

export const reviewEngineer = async (req, res, next) => {
  try {
    const { engineerUserId } = req.params;
    const { decision, note } = req.body; // APPROVE | REJECT

    const daoStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";

    const p = await EngineerProfile.findOneAndUpdate(
      { userId: engineerUserId },
      {
        $set: {
          daoStatus,
          daoReviewedAt: new Date(),
          daoReviewer: req.user.id,
          daoNote: note || "",
        },
      },
      { new: true }
    ).lean();

    if (!p) return res.status(404).json({ error: "profile_not_found" });
    res.json(p);
  } catch (err) {
    next(err);
  }
};

export const listPayments = async (_req, res, next) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).lean();
    res.json(payments);
  } catch (err) {
    next(err);
  }
};

export const refundPayment = async (req, res, next) => {
  try {
    const { workflowId } = req.params;
    const { reason } = req.body;

    const result = await DaoRevolutAdapter.refund({ workflowId, reason });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

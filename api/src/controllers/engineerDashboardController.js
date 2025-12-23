// src/controllers/engineerDashboardController.js
import EngineerProfile from "../models/EngineerProfile.js";
import Task from "../models/taskModel.js";
import Payment from "../models/paymentModel.js";
import DaoRevolutAdapter from "../services/DaoRevolutAdapter.js";
import * as widgetBus from "../realtime/widgetBus.js";


/* ---------- Profile Setup ---------- */

export const getEngineerProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    let profile = await EngineerProfile.findOne({ userId }).lean();
    if (!profile) {
      profile = await EngineerProfile.create({
        userId,
        daoStatus: "NOT_SUBMITTED",
      });
      profile = profile.toObject();
    }
    res.json(profile);
  } catch (err) {
    next(err);
  }
};

export const saveEngineerProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const payload = req.body;
    const profile = await EngineerProfile.findOneAndUpdate(
      { userId },
      { $set: payload },
      { upsert: true, new: true }
    ).lean();
    res.json(profile);
  } catch (err) {
    next(err);
  }
};

export const submitProfileToDAO = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await EngineerProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          daoStatus: "PENDING",
          daoSubmittedAt: new Date(),
          daoNote: null,
        },
      },
      { new: true }
    ).lean();
    res.json(profile);
  } catch (err) {
    next(err);
  }
};

export const getDAOStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const p = await EngineerProfile.findOne({ userId }).lean();
    res.json({
      status: p?.daoStatus || "NOT_SUBMITTED",
      submittedAt: p?.daoSubmittedAt || null,
      reviewedAt: p?.daoReviewedAt || null,
      reviewer: p?.daoReviewer || null,
      note: p?.daoNote || "",
    });
  } catch (err) {
    next(err);
  }
};

export const resubmitDAO = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const p = await EngineerProfile.findOneAndUpdate(
      { userId },
      {
        $set: {
          daoStatus: "PENDING",
          daoSubmittedAt: new Date(),
          daoReviewedAt: null,
          daoReviewer: null,
          daoNote: null,
        },
      },
      { new: true }
    ).lean();
    res.json(p);
  } catch (err) {
    next(err);
  }
};

/* ---------- Task Inbox lifecycle ---------- */

export const getTasksForEngineer = async (req, res, next) => {
  try {
    const engineerId = req.user.id;
    const tasks = await Task.find({ engineerId }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch (err) {
    next(err);
  }
};

export const setTaskStatus = (newStatus, extraFields = {}) => {
  return async (req, res, next) => {
    try {
      const engineerId = req.user.id;
      const { id } = req.params;

      const updates = { status: newStatus, ...extraFields };
      const t = await Task.findOneAndUpdate(
        { _id: id, engineerId },
        { $set: updates },
        { new: true }
      ).lean();

      if (!t) return res.status(404).json({ error: "task_not_found" });
      res.json(t);
    } catch (err) {
      next(err);
    }
  };
};

/* ---------- RAMS / evidence + completion ---------- */

export const saveTaskRams = async (req, res, next) => {
  try {
    const engineerId = req.user.id;
    const { id } = req.params;
    const { riskAssessed, ppeChecked, isolationConfirmed, status } = req.body;

    const t = await Task.findOneAndUpdate(
      { _id: id, engineerId },
      {
        $set: {
          "ramsChecklist.riskAssessed": !!riskAssessed,
          "ramsChecklist.ppeChecked": !!ppeChecked,
          "ramsChecklist.isolationConfirmed": !!isolationConfirmed,
          "ramsChecklist.status": status || "OK",
        },
      },
      { new: true }
    ).lean();

    if (!t) return res.status(404).json({ error: "task_not_found" });
    res.json(t);
  } catch (err) {
    next(err);
  }
};

export const saveTaskEvidence = async (req, res, next) => {
  try {
    const engineerId = req.user.id;
    const { id } = req.params;
    const { beforePhotoName, afterPhotoName, notes, status } = req.body;

    const t = await Task.findOneAndUpdate(
      { _id: id, engineerId },
      {
        $set: {
          "evidence.beforePhotoName": beforePhotoName,
          "evidence.afterPhotoName": afterPhotoName,
          "evidence.notes": notes,
          "evidence.status": status || "UPLOADED",
        },
      },
      { new: true }
    ).lean();

    if (!t) return res.status(404).json({ error: "task_not_found" });
    res.json(t);
  } catch (err) {
    next(err);
  }
};

export const completeTask = async (req, res, next) => {
  try {
    const engineerId = req.user.id;
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, engineerId });
    if (!task) return res.status(404).json({ error: "task_not_found" });

    const r = task.ramsChecklist || {};
    const e = task.evidence || {};
    const allRamsOk = r.riskAssessed && r.ppeChecked && r.isolationConfirmed;
    const evidenceOk = e.beforePhotoName && e.afterPhotoName;
    if (!allRamsOk || !evidenceOk) {
      return res.status(400).json({ error: "rams_or_evidence_incomplete" });
    }

    task.status = "COMPLETED";
    task.completedAt = new Date();
    await task.save();

    // Payout from escrow to engineer
    const amountGBP = task.jobWallet?.amount || 200;
    await DaoRevolutAdapter.approveAndPay({
      workflowId: task.ticketId,
      engineerId,
      amountGBP,
    });

    res.json(task);
  } catch (err) {
    next(err);
  }
};

/* ---------- Job Wallets for Earnings widget ---------- */

export const getJobWallets = async (req, res, next) => {
  try {
    const engineerId = req.user.id;
    const tasks = await Task.find({
      engineerId,
      "jobWallet.amount": { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .lean();

    const wallets = tasks.map((t) => ({
      taskId: t._id.toString(),
      title: t.title,
      amount: t.jobWallet.amount,
      currency: t.jobWallet.currency,
      provider: t.jobWallet.provider,
      slaHours: t.jobWallet.slaHours,
      etaMinutes: t.jobWallet.etaMinutes,
      rate: t.jobWallet.rate,
      createdAt: t.createdAt,
    }));

    res.json(wallets);
  } catch (err) {
    next(err);
  }
};

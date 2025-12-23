// src/models/Task.js
import mongoose from "mongoose";

const RamsChecklistSchema = new mongoose.Schema(
  {
    riskAssessed: { type: Boolean, default: false },
    ppeChecked: { type: Boolean, default: false },
    isolationConfirmed: { type: Boolean, default: false },
    status: { type: String, default: "PENDING" },
  },
  { _id: false }
);

const EvidenceSchema = new mongoose.Schema(
  {
    status: { type: String, default: "PENDING" },
    beforePhotoName: String,
    afterPhotoName: String,
    notes: String,
  },
  { _id: false }
);

const JobWalletSchema = new mongoose.Schema(
  {
    provider: { type: String, default: "Revolut Business (demo)" },
    amount: { type: Number, default: 200 },
    currency: { type: String, default: "GBP" },
    rate: { type: Number, default: 65 },
    etaMinutes: { type: Number, default: 30 },
    slaHours: { type: Number, default: 2 },
    pan: String,
    last4: String,
    cvv: String,
    validThru: String,
    cardId: String,
  },
  { _id: false }
);

const TaskSchema = new mongoose.Schema(
  {
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", index: true },
    engineerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    title: String,
    site: String,
    priority: String,
    trade: String,
    status: {
      type: String,
      enum: ["NEW", "ASSIGNED", "EN_ROUTE", "ON_SITE", "DECLINED", "COMPLETED"],
      default: "NEW",
    },
    slaHours: { type: Number, default: 2 },
    slaDeadline: Date,
    createdAtMs: { type: Number, default: () => Date.now() },
    acceptedAt: Date,
    enRouteAt: Date,
    onSiteAt: Date,
    completedAt: Date,
    ramsChecklist: RamsChecklistSchema,
    evidence: EvidenceSchema,
    jobWallet: JobWalletSchema,
  },
  { timestamps: true }
);

export default mongoose.model("Task", TaskSchema);

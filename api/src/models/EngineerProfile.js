// src/models/EngineerProfile.js
import mongoose from "mongoose";

const EngineerProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    fullName: String,
    phone: String,
    primaryTrade: String,
    certifications: String,
    walletAddress: String,
    insurancePolicy: String,
    country: String,
    city: String,
    language: String,
    hourlyRate: Number,
    rating: { type: Number, default: 4.8 },
    completedJobs: { type: Number, default: 0 },
    reputationScore: { type: Number, default: 720 },
    daoStatus: {
      type: String,
      enum: ["NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED"],
      default: "NOT_SUBMITTED",
    },
    daoSubmittedAt: Date,
    daoReviewedAt: Date,
    daoReviewer: String,
    daoNote: String,
  },
  { timestamps: true }
);

EngineerProfileSchema.index({ userId: 1 }, { unique: true });

export default mongoose.model("EngineerProfile", EngineerProfileSchema);

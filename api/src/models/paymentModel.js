// src/models/paymentModel.js
import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    workflowId: { type: mongoose.Schema.Types.ObjectId, index: true }, // Ticket or Task
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    engineerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    escrowId: String,
    state: {
      type: String,
      enum: [
        "ESCROW_HELD",
        "PAYOUT_REQUESTED",
        "PAYOUT_FAILED",
        "REFUND_REQUESTED",
        "REFUNDED",
      ],
      default: "ESCROW_HELD",
    },
    currency: { type: String, default: "GBP" },
    gross: Number,
    feePct: { type: Number, default: 10 },
    payoutRef: String,
    payoutNetGBP: Number,
    payoutFeeGBP: Number,
    refundReason: String,
  },
  { timestamps: true }
);

PaymentSchema.index({ workflowId: 1 });

export default mongoose.model("Payment", PaymentSchema);

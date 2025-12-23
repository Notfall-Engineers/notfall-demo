// src/models/Ticket.js
import mongoose from "mongoose";

const TicketSchema = new mongoose.Schema(
  {
    // Production identity (real users)
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
      default: null,
    },

    // ✅ Demo identity (string ids like "demo_user_001")
    demoClientId: {
      type: String,
      index: true,
      default: null,
    },

    roleContext: {
      type: String,
      enum: ["CLIENT", "FM", "TENANT", "PLC"],
      default: "CLIENT",
    },

    site: String,
    summary: String,
    description: String,
    priority: { type: String, default: "MEDIUM" },
    trade: String,
    depositAmountGBP: { type: Number, default: 200 },

    status: {
      type: String,
      enum: [
        "NEW",
        "ESCROW_HELD",
        "MATCHING",
        "ENGINEER_ASSIGNED",
        "IN_PROGRESS",
        "COMPLETED",
        "REFUND_REQUESTED",
        "CLOSED",
      ],
      default: "NEW",
    },

    engineerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    escrowId: String,
  },
  { timestamps: true }
);

// Helpful compound index (optional)
TicketSchema.index({ demoClientId: 1, createdAt: -1 });

export default mongoose.model("Ticket", TicketSchema);

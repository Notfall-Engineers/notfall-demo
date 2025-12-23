import mongoose from "mongoose";

/**
 * EscrowLedger
 * -------------
 * Demo + production-aligned escrow ledger.
 * Mirrors Revolut operational semantics while remaining demo-safe.
 *
 * Status lifecycle:
 * HELD_IN_ESCROW → RELEASED_TO_ENGINEER | REFUNDED_TO_CLIENT
 */

const EscrowLedgerSchema = new mongoose.Schema(
  {
    // ---- Context --------------------------------------------------
    ticketId: {
      type: String,
      index: true,
      description: "Workflow / ticket reference",
    },

    site: {
      type: String,
      description: "Human-readable site reference",
    },

    // ---- Financials ----------------------------------------------
    amountGBP: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "GBP",
      immutable: true,
    },

    reference: {
      type: String,
      description: "User-facing payment reference",
    },

    payerName: {
      type: String,
      description: "Client / FM name",
    },

    reconciliationRef: {
      type: String,
      required: true,
      unique: true,
      description: "Ops-grade reconciliation reference (NF-ESCROW-*)",
    },

    // ---- Escrow state --------------------------------------------
    status: {
      type: String,
      enum: [
        "HELD_IN_ESCROW",
        "RELEASED_TO_ENGINEER",
        "REFUNDED_TO_CLIENT",
      ],
      default: "HELD_IN_ESCROW",
      index: true,
    },

    releasedTo: {
      type: Object,
      default: null,
      description: "Engineer payout metadata",
    },

    refundedTo: {
      type: Object,
      default: null,
      description: "Client refund metadata",
    },

    // ---- Audit trail ---------------------------------------------
    statusHistory: {
      type: [
        {
          at: { type: Date, default: Date.now },
          status: { type: String },
          note: { type: String },
          role: { type: String },
          engineerId: { type: String },
          clientId: { type: String },
        },
      ],
      default: [],
    },
  },
  {
    /**
     * Use mongoose timestamps instead of manual createdAt
     * Prevents duplicate index warnings and keeps consistency.
     */
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
  }
);

// ---- Indexes (explicit, non-duplicated) ---------------------------

// For ticket → escrow history
EscrowLedgerSchema.index({ ticketId: 1, createdAt: -1 });

// For dashboards / ops views
EscrowLedgerSchema.index({ status: 1, createdAt: -1 });

// ---- Export -------------------------------------------------------

export default mongoose.model("EscrowLedger", EscrowLedgerSchema);

import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * AuditEvent / AuditLog
 * Governance + compliance trail
 * DSSAdapter.recordEvent → Audit.recordDssAudit()
 */
const AuditEventSchema = new Schema(
  {
    runId: { type: String, index: true },
    dssRunId: { type: String, index: true },
    scope: { type: String, index: true },
    action: { type: String, index: true },

    // ✅ Updated: allow "warning"
    severity: {
      type: String,
      enum: ["debug", "info", "warning", "low", "medium", "high", "critical"],
      default: "info",
      index: true,
    },

    pseudonym: { type: String, default: null, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },

    performedBy: { type: String, default: null },
    performerWallet: { type: String, default: null },
    performerRole: { type: String, default: "System" },

    targets: {
      user: { type: String, default: null },
      engineer: { type: String, default: null },
      proposal: { type: String, default: null },
      device: { type: String, default: null },
      badge: { type: String, default: null },
    },

    txHash: { type: String, default: null },

    exportStatus: {
      type: String,
      enum: ["pending", "exported", "skipped"],
      default: "pending",
    },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

AuditEventSchema.index({ scope: 1, action: 1, createdAt: -1 });

AuditEventSchema.statics.recordDssAudit = async function (data) {
  const { runId } = data || {};
  const doc = await this.create({
    ...data,
    dssRunId: runId || data?.dssRunId || null,
  });
  return doc;
};

export default mongoose.model("AuditLog", AuditEventSchema);

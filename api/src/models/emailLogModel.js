import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * EmailLog
 * Outbound emails, linked to DSS runs via meta.runId
 * DSSAdapter.dailyExport / exportRun include these in FCA export.
 */
const EmailLogSchema = new Schema(
  {
    to: {
      type: [String],
      default: [],
      index: true,
    },
    cc: {
      type: [String],
      default: [],
    },
    bcc: {
      type: [String],
      default: [],
    },
    subject: {
      type: String,
      default: "",
      index: true,
    },
    template: {
      type: String,
      default: null,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
      // e.g. { runId: "uuid", category: "plcAlert", userId: "..." }
    },
    provider: {
      type: String,
      default: "local",
    },
    status: {
      type: String,
      enum: ["queued", "sent", "failed"],
      default: "queued",
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

EmailLogSchema.index({ "meta.runId": 1, createdAt: 1 });

/**
 * Optional helper if we want to log emails centrally.
 */
EmailLogSchema.statics.logEmail = async function (data) {
  return this.create(data);
};

export default mongoose.model("EmailLog", EmailLogSchema);

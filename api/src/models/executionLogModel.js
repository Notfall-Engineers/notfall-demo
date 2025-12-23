import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * ExecutionLog
 * Operational trail (workflow / task level)
 * DSSAdapter.recordEvent → ExecutionLog.recordDssEvent()
 */
const ExecutionLogSchema = new Schema(
  {
    workflow: {
      type: Schema.Types.ObjectId,
      ref: "Workflow",
      required: false,
      index: true,
    },
    task: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: false,
      index: true,
    },
    dssRunId: {
      type: String,
      index: true,
    },
    dssScope: {
      type: String,
      index: true,
    },
    dssAction: {
      type: String,
      index: true,
    },
    dssAuditLevel: {
      type: String,
      default: "info",
      index: true,
    },
    dssRiskScore: {
      type: Number,
      default: 0,
      index: true,
    },
    dssPseudonym: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      default: null,
    },
    evidence: {
      type: Schema.Types.Mixed,
      default: {},
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

ExecutionLogSchema.index({ dssRunId: 1, createdAt: 1 });

/**
 * ExecutionLog.recordDssEvent() – called from DSSAdapter.recordEvent()
 */
ExecutionLogSchema.statics.recordDssEvent = async function (data) {
  const doc = await this.create({
    ...data,
    // if workflowId was passed in payload, mirror to workflow field
    workflow: data.workflow || data.workflowId || null,
    task: data.task || data.taskId || null,
  });
  return doc;
};

export default mongoose.model("ExecutionLog", ExecutionLogSchema);

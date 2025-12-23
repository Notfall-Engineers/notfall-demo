import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * DSSRun
 * - one row per DSS evaluation / guarded flow
 * - DSSAdapter.startRun() → creates with status "running"
 * - run.finish({ status, exportBatchId }) → marks complete
 */
const DssRunSchema = new Schema(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    initiatedBy: {
      type: String, // user id / wallet / system
      default: null,
      index: true,
    },
    tester: {
      type: String,
      default: null,
    },
    testerEngineer: {
      type: String,
      default: null,
    },
    testerWallet: {
      type: String,
      default: null,
    },
    caps: {
      type: Schema.Types.Mixed,
      default: {},
    },
    scope: {
      type: String,
      default: "general",
      index: true,
    },
    pseudonym: {
      type: String,
      default: null,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
      index: true,
    },
    exportBatchId: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

/**
 * DSSRun.start({ ... }) – used by DSSAdapter.startRun()
 */
DssRunSchema.statics.start = async function (data) {
  const doc = await this.create({
    ...data,
    status: "running",
    startedAt: new Date(),
  });
  return doc;
};

/**
 * run.finish({ status, exportBatchId }) – used by DSSAdapter.finishRun()
 */
DssRunSchema.methods.finish = async function ({ status, exportBatchId } = {}) {
  if (status) this.status = status;
  if (exportBatchId) this.exportBatchId = exportBatchId;
  this.finishedAt = new Date();
  await this.save();
  return this;
};

export default mongoose.model("DSSRun", DssRunSchema);

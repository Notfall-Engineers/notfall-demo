import mongoose from "mongoose";

const TelemetryEventSchema = new mongoose.Schema(
  {
    userId: { type: String },
    workflowId: { type: String },
    role: { type: String },
    type: { type: String, required: true },
    payload: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// ✅ Define indexes ONCE (avoid index:true + schema.index duplication)
TelemetryEventSchema.index({ userId: 1 });
TelemetryEventSchema.index({ workflowId: 1 });
TelemetryEventSchema.index({ createdAt: -1 });

export default mongoose.model("TelemetryEvent", TelemetryEventSchema);

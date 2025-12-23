import mongoose from "mongoose";

const AnalyticsEventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sessionId: { type: String },
    role: { type: String },
    engineerId: { type: String },
    clientId: { type: String },
    props: { type: Object, default: {} },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

AnalyticsEventSchema.index({ name: 1, createdAt: -1 });
AnalyticsEventSchema.index({ sessionId: 1, createdAt: -1 });
AnalyticsEventSchema.index({ role: 1, createdAt: -1 });

export default mongoose.model("AnalyticsEvent", AnalyticsEventSchema);

// src/models/layoutPrefsModel.js
import mongoose from "mongoose";

const LayoutPrefsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    role: { type: String, required: true }, // ENGINEER / CLIENT / DAO_ADMIN
    instances: [
      {
        widgetId: String,
        order: Number,
        enabled: { type: Boolean, default: true },
      },
    ],
    updatedAt: Date,
  },
  { timestamps: true }
);

LayoutPrefsSchema.index({ userId: 1, role: 1 }, { unique: true });

export default mongoose.model("LayoutPrefs", LayoutPrefsSchema);

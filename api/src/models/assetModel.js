// api/src/models/assetModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Asset
 * Represents a plant item / system registered by a client/FM.
 * Examples: Boiler #1, AHU-03, Chiller-02, EV Charger Bay 7, etc.
 */
const assetSchema = new Schema(
  {
    // Ownership / tenancy scoping (null allowed for demo assets)
    clientId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, default: null },

    siteName: { type: String, required: true, trim: true },
    siteCode: { type: String, trim: true, default: null },

    type: { type: String, trim: true, default: null }, // e.g. "HVAC", "Chiller"
    criticality: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },

    plcTag: { type: String, trim: true, default: null }, // e.g. "DB1.FaultCode"

    meta: { type: Schema.Types.Mixed, default: {} },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "DECOMMISSIONED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

/**
 * Indexes (define ONLY here to avoid duplicate-index warnings)
 */

// Assets by client + site + status
assetSchema.index({ clientId: 1, siteCode: 1, status: 1 });

// Incoming PLC alerts lookup
assetSchema.index({ plcTag: 1 });

// Search
assetSchema.index({ name: "text", siteName: "text", code: "text" });

/**
 * Safe model compilation (prevents OverwriteModelError in nodemon/watch)
 */
const Asset = mongoose.models.Asset || mongoose.model("Asset", assetSchema);

export default Asset;

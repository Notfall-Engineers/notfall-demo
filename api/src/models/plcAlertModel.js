// api/src/models/plcAlertModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * PlcAlert
 *
 * A single alert/event raised from a PLC / BMS / industrial controller.
 * Can be linked to an Asset and/or Client.
 */

const plcAlertSchema = new Schema(
  {
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
    },

    clientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    severity: {
      type: String,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium",
    },

    code: {
      type: String,
      trim: true,
      // e.g. "AHU_LOCKOUT", "BOILER_LOW_PRESSURE"
    },

    message: {
      type: String,
      trim: true,
    },

    plcTag: {
      type: String,
      trim: true,
      // e.g. "DB1.FaultSignal"
    },

    siteName: {
      type: String,
      trim: true,
    },

    siteCode: {
      type: String,
      trim: true,
    },

    meta: {
      type: Schema.Types.Mixed,
      default: {},
      // rawPayload, controllerId, lineId, alarmClass, etc.
    },

    acknowledgedAt: {
      type: Date,
    },

    clearedAt: {
      type: Date,
    },

    acknowledgedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },

    clearedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
  }
);

/**
 * Indexes
 */

// Most common: recent alerts per client/site, sorted by createdAt
plcAlertSchema.index({ clientId: 1, siteCode: 1, createdAt: -1 });

// Link to an asset quickly
plcAlertSchema.index({ assetId: 1, createdAt: -1 });

// Filter by severity for dashboards / SLA / DAO guardrail views
plcAlertSchema.index({ severity: 1, createdAt: -1 });

// Safe model compilation
const PlcAlert =
  mongoose.models.PlcAlert || mongoose.model("PlcAlert", plcAlertSchema);

export default PlcAlert;

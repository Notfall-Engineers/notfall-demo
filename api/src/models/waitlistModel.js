// api/src/models/waitlistModel.js
import mongoose from "mongoose";

const waitlistSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    workEmail: { type: String, required: true, lowercase: true, trim: true },
    persona: { type: String, required: true, trim: true },
    region: { type: String, required: true, trim: true },

    // NEW FIELDS
    // Stored as an array in Mongo, even though the form sends a comma-separated string
    interests: { type: [String], default: [] },      // e.g. ["faster", "compliance"]
    tenOutOfTen: { type: String, trim: true },       // “Real-time visibility…” etc.
    referrer: { type: String, trim: true },          // linkedin, google, etc.

    source: { type: String, default: "landing" }
  },
  {
    timestamps: true,
    // Use env if present, else default:
    collection: process.env.WAITLIST_COLLECTION || "dao_waitlist_v1"
  }
);

// Index for fast lookups; keep non-unique so the same email can appear multiple times if needed
waitlistSchema.index({ workEmail: 1 }, { unique: false });

export const WaitlistEntry =
  mongoose.models.WaitlistEntry ||
  mongoose.model("WaitlistEntry", waitlistSchema);

export default WaitlistEntry;

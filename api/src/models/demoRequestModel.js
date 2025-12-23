// models/demoRequestModel.js
import mongoose from "mongoose";

const demoRequestSchema = new mongoose.Schema(
  {
    // core identity
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    company: { type: String, trim: true },
    role: { type: String, trim: true },
    size: { type: String, trim: true },        // portfolio / team size
    time: { type: String, trim: true },        // preferred time window
    notes: { type: String, trim: true },

    // cross-link to waitlist persona info (optional)
    persona: { type: String, trim: true },
    region: { type: String, trim: true },
    interests: [{ type: String, trim: true }],
    tenOutOfTen: { type: String, trim: true },
    referrer: { type: String, trim: true },

    source: { type: String, default: "landing", index: true }, // landing / sales / partner

    // token to personalise the React demo page
    demoToken: { type: String, unique: true, index: true }
  },
  { timestamps: true }
);

export default mongoose.model("DemoRequest", demoRequestSchema);

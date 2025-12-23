// api/src/models/ramsModel.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * RAMS Model
 * One RAMS document per task (versioned).
 *
 * - taskId: Task reference
 * - status: DRAFT | SUBMITTED | APPROVED | REJECTED
 * - version: integer, increments on major update
 * - notes: free text / JSON-stringified notes
 * - updatedBy: userId of last editor
 */
const ramsSchema = new Schema(
  {
    taskId: {
      type: Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"],
      default: "DRAFT",
      index: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    notes: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Useful compound index for dashboards
ramsSchema.index({ taskId: 1, status: 1 });

const Rams = mongoose.model("Rams", ramsSchema);

export default Rams;

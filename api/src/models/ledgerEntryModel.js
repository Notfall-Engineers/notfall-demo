// src/models/ledgerEntryModel.js
import mongoose from "mongoose";

const LedgerEntrySchema = new mongoose.Schema(
  {
    account: String,
    type: { type: String, enum: ["DEBIT", "CREDIT"] },
    amountGBP: Number,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

LedgerEntrySchema.statics.debit = function (account, amountGBP, meta = {}) {
  return {
    insertOne: { document: { account, type: "DEBIT", amountGBP, meta } },
  };
};

LedgerEntrySchema.statics.credit = function (account, amountGBP, meta = {}) {
  return {
    insertOne: { document: { account, type: "CREDIT", amountGBP, meta } },
  };
};

LedgerEntrySchema.statics.write = function (op) {
  return this.bulkWrite([op]);
};

export default mongoose.model("LedgerEntry", LedgerEntrySchema);
